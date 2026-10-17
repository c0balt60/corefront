import { OnStart, Service } from "@flamework/core";
import { subscribe } from "@rbxts/charm";
import { Cmdr } from "@rbxts/cmdr";
import { Players, StarterPack } from "@rbxts/services";
import { t } from "@rbxts/t";

import { DataService } from "core/Data/server/DataService";
import { BaseService } from "game/Base/server/BaseService";
import { WaveService } from "game/Base/server/WaveService";
import { nearestZone } from "game/Base/shared/buildings";
import { PlanetsService } from "game/Planets/server/PlanetsService";
import { isUnlocked, stepIndex, TUTORIAL_DONE, type TutorialLock } from "game/Tutorial/shared/tutorial";
import { TutorialMessage, tutorialMessaging } from "game/Tutorial/shared/tutorial-network";

const isAdvanceData = t.interface({ step: t.integer });

/** The practice aliens: how many, what kind and how far from the Core, toward its nearest drop zone, in studs. */
const PRACTICE_COUNT = 3;
const PRACTICE_KIND = "crawler";
const PRACTICE_STUDS = 100;
/** Seconds between checks of whether the waves should be held. */
const HOLD_SECONDS = 0.5;

/**
 * The tutorial's server side. Progress is saved per player (`PlayerData.tutorial`, see `TUTORIAL_STEPS`): the
 * client says when it has seen a step done, except the shoot step, which this finishes itself. It holds the
 * Blaster back until its step, sends practice aliens at it, and holds the waves (see `WaveService.holdAtom`)
 * while anyone on the first planet is still learning. A sandbox has no tutorial.
 */
@Service()
export class TutorialService implements OnStart {
	/** Who has had their practice aliens for the step they're on, and the map they were sent on. */
	private readonly practiced = new Map<Player, ReturnType<PlanetsService["currentMap"]>>();
	/** Stops watching a player's data. */
	private readonly untrack = new Map<Player, () => void>();

	constructor(
		private readonly dataService: DataService,
		private readonly baseService: BaseService,
		private readonly planetsService: PlanetsService,
		private readonly waveService: WaveService,
	) {}

	onStart() {
		tutorialMessaging.server.on(TutorialMessage.Advance, (player, data) => {
			if (!isAdvanceData(data)) return;
			const current = this.progressOf(player);
			if (data.step === current && current < TUTORIAL_DONE) this.setProgress(player, current + 1);
		});
		tutorialMessaging.server.on(TutorialMessage.Skip, (player) => this.setProgress(player, TUTORIAL_DONE));

		for (const player of Players.GetPlayers()) this.track(player);
		Players.PlayerAdded.Connect((player) => this.track(player));
		Players.PlayerRemoving.Connect((player) => {
			this.practiced.delete(player);
			this.untrack.get(player)?.();
			this.untrack.delete(player);
		});
		subscribe(this.baseService.sandbox, () => Players.GetPlayers().forEach((player) => this.giveBlaster(player)));

		this.waveService.canCall = (player) => this.unlocked(player, "callWave");

		Cmdr.Registry.RegisterCommandsIn(script.Parent!.WaitForChild("commands"));

		// ponytail: polls; who is deployed and which planet is active have no atom to subscribe to.
		task.spawn(() => {
			while (true) {
				this.waveService.holdAtom(this.shouldHold());
				for (const player of Players.GetPlayers()) {
					// A new planet has none of the aliens sent at the last.
					if (this.practiced.get(player) !== this.planetsService.currentMap()) this.practiced.delete(player);
					this.practise(player);
					this.finishPractice(player);
				}
				task.wait(HOLD_SECONDS);
			}
		});
	}

	/** A player's tutorial progress: 0 before their data loads. */
	progressOf(player: Player): number {
		return this.dataService.getData(player)?.tutorial ?? 0;
	}

	/** Moves a player to `progress` (a step index, or `TUTORIAL_DONE`). Does nothing before their data loads. */
	setProgress(player: Player, progress: number) {
		this.dataService.update(player, (data) => ({ ...data, tutorial: progress }));
	}

	/** Whether `player` may use `lock` yet. Always, in a sandbox. */
	unlocked(player: Player, lock: TutorialLock): boolean {
		return this.baseService.sandbox() || isUnlocked(this.progressOf(player), lock);
	}

	private track(player: Player) {
		const unsubscribe = subscribe(this.dataService.selectData(player), (now, before) => {
			if (now?.tutorial === before?.tutorial) return;
			this.practiced.delete(player);
			this.giveBlaster(player);
			this.practise(player);
			this.waveService.holdAtom(this.shouldHold());
		});
		this.untrack.set(player, unsubscribe);

		// The Backpack is made anew at each spawn, and fills a moment after CharacterAdded.
		const guard = (backpack: Backpack) => {
			const strip = (child: Instance) => {
				if (!child.IsA("Tool") || child.Name !== "Blaster") return;
				// Deferred: under immediate signals the Tool is still being parented.
				task.defer(() => {
					if (!this.unlocked(player, "blaster")) child.Destroy();
				});
			};
			backpack.GetChildren().forEach(strip);
			backpack.ChildAdded.Connect(strip);
		};
		player.ChildAdded.Connect((child) => child.IsA("Backpack") && guard(child));
		const backpack = player.FindFirstChildOfClass("Backpack");
		if (backpack) guard(backpack);
	}

	/** Hands over the Blaster once its step is reached, if they don't have it. A spawn brings it itself. */
	private giveBlaster(player: Player) {
		const backpack = player.FindFirstChildOfClass("Backpack");
		if (!player.Character || !backpack || !this.unlocked(player, "blaster")) return;
		if (backpack.FindFirstChild("Blaster") || player.Character.FindFirstChild("Blaster")) return;
		const blaster = StarterPack.FindFirstChild("Blaster")?.Clone();
		if (blaster) blaster.Parent = backpack;
	}

	/**
	 * Marks where the practice aliens will land on a deployed player on the shoot step (`TutorialSpawn`, for the
	 * client to show), and sends them there, once, when the player has their Blaster out.
	 */
	private practise(player: Player) {
		const map = this.planetsService.currentMap();
		const zones = map?.dropZones ?? [];
		if (
			!map ||
			zones.isEmpty() ||
			this.baseService.sandbox() ||
			this.progressOf(player) !== stepIndex("shoot") ||
			!this.planetsService.isDeployed(player)
		) {
			player.SetAttribute("TutorialSpawn", undefined);
			return;
		}
		if (this.practiced.has(player)) return;
		// The drop zone nearest the Core: the way the aliens come from.
		const core = new Vector3(map.landing.X, 0, map.landing.Z);
		const toward = nearestZone(zones, core)!;
		const direction = new Vector3(toward.X - core.X, 0, toward.Z - core.Z);
		const at = direction.Magnitude > 1e-3 ? core.add(direction.Unit.mul(PRACTICE_STUDS)) : core;
		player.SetAttribute("TutorialSpawn", new Vector3(at.X, map.landing.Y, at.Z));
		if (
			player.Character?.FindFirstChild("Blaster")?.IsA("Tool") &&
			this.waveService.queue(PRACTICE_KIND, PRACTICE_COUNT, at)
		) {
			this.practiced.set(player, map);
		}
	}

	/** Finishes the shoot step for a player whose practice aliens have all gone. */
	private finishPractice(player: Player) {
		if (!this.practiced.has(player) || this.progressOf(player) !== stepIndex("shoot")) return;
		if (this.waveService.isClear()) this.setProgress(player, stepIndex("shoot") + 1);
	}

	/** Whether the first wave waits: on the first planet, while someone there hasn't reached the defence. */
	private shouldHold(): boolean {
		if (this.baseService.sandbox() || this.planetsService.activeAtom() !== 0 || this.planetsService.isConquered(0))
			return false;
		const defend = stepIndex("defend");
		return Players.GetPlayers().some(
			(player) => this.planetsService.isDeployed(player) && this.progressOf(player) < defend,
		);
	}
}
