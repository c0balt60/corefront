import { OnStart, Service } from "@flamework/core";
import { listen, subscribe } from "@rbxts/charm";
import type { Logger } from "@rbxts/log";

import { IS_STUDIO } from "core/shared/constants";
import { readSave, updateSave } from "core/Worlds/server/saves";
import { ArrivalService, type World } from "game/Arrival/server/ArrivalService";
import { BaseService, type SavedBase } from "game/Base/server/BaseService";
import type { ResourceId } from "game/Base/shared/resources";
import { PlanetsService } from "game/Planets/server/PlanetsService";
import { discoveredAtom, personal, teamAtom } from "game/Research/server/research-store";
import type { Levels } from "game/Research/shared/research";

/** Seconds between autosaves. */
const AUTOSAVE_SECONDS = 60;
/** Reads of the save before the world gives up on it. */
const READ_TRIES = 5;

/** A world's progress, as its save slot keeps it. Keyed by strings, not numbers, so it stays JSON-safe. */
interface Progress {
	/** The planet the team was on. */
	readonly active: number;
	readonly unlocked: ReadonlyArray<number>;
	readonly conquered: ReadonlyArray<number>;
	readonly team: Levels;
	/** Each player's own research, by UserId. */
	readonly personal: Readonly<Record<string, Levels>>;
	readonly discovered: ReadonlyArray<ResourceId>;
	/** Bases by planet index. */
	readonly bases: Readonly<Record<string, SavedBase>>;
}

/**
 * The world's save slot. Once the world is known, puts its saved progress back
 * (planets, research and bases) and starts the campaign where it left off, or
 * on the first planet. Saves on landing, on liberating a planet, every
 * `AUTOSAVE_SECONDS` and on shutdown. The save only takes writes from the world
 * whose join code it holds, so a deleted slot, or one loaded again elsewhere,
 * is left alone. Waves restart on load: only bases and the campaign are kept.
 */
@Service()
export class SaveService implements OnStart {
	/** Off without a save, or one that could not be read: writing then would wipe it. */
	private saving = false;
	private writing = false;

	constructor(
		private readonly logger: Logger,
		private readonly arrivalService: ArrivalService,
		private readonly baseService: BaseService,
		private readonly planetsService: PlanetsService,
	) {}

	onStart() {
		listen(this.arrivalService.worldAtom, (world) => {
			if (world) task.spawn(() => this.load(world));
		});

		// Saving yields, so never inside a Charm callback.
		const save = () => task.spawn(() => this.save());
		subscribe(
			() => this.planetsService.travelAtom() === undefined,
			(landed) => {
				if (landed) save();
			},
		);
		// Cleared after a win once the planet is liberated.
		subscribe(this.baseService.resultAtom, (result, previous) => {
			if (previous === "won" && result === undefined) save();
		});
		task.spawn(() => {
			while (true) {
				task.wait(AUTOSAVE_SECONDS);
				this.save();
			}
		});
		if (!IS_STUDIO) game.BindToClose(() => this.save(true));
	}

	private load(world: World) {
		let progress: Progress | undefined;
		if (world.save) {
			for (let attempt = 1; attempt <= READ_TRIES; attempt++) {
				const save = readSave(world.save);
				if (save === false) {
					if (attempt < READ_TRIES) task.wait(2 ** attempt);
					continue;
				}
				if (save?.code === world.code) {
					this.saving = true;
					progress = save.progress as Progress | undefined;
				} else {
					this.logger.Warn(
						"Save slot {Slot} no longer belongs to world {Code}. Not saving",
						world.save.slot,
						world.code,
					);
				}
				break;
			}
			if (!this.saving)
				this.logger.Error("Could not load the save for world {Code}. Progress won't be saved", world.code);
		}

		if (progress) this.restore(progress);
		const active = progress && this.planetsService.isUnlocked(progress.active) ? progress.active : 0;
		this.planetsService.activate(active);
	}

	private restore(progress: Progress) {
		this.planetsService.restore(progress.unlocked, progress.conquered);
		teamAtom(progress.team);
		for (const [userId, levels] of pairs(progress.personal)) personal.set(tonumber(userId)!, levels);
		const bases = new Map<number, SavedBase>();
		for (const [planet, base] of pairs(progress.bases)) bases.set(tonumber(planet)!, base);
		this.baseService.restore(bases);
		// Last, as setting it sends everyone their research.
		discoveredAtom(progress.discovered);
		this.logger.Info(
			"Loaded progress: planet {Planet}, {Count} liberated",
			progress.active,
			progress.conquered.size(),
		);
	}

	/** Writes the progress, unless a write is already going. `force` writes anyway, for the last save at shutdown. */
	private save(force = false) {
		const world = this.arrivalService.getWorld();
		const active = this.planetsService.activeAtom();
		if (!this.saving || !world?.save || active === undefined || (this.writing && !force)) return;

		const researched: Record<string, Levels> = {};
		for (const [userId, levels] of personal) researched[tostring(userId)] = levels;
		const bases: Record<string, SavedBase> = {};
		for (const [planet, base] of this.baseService.getBases()) bases[tostring(planet)] = base;
		const conquered = [...this.planetsService.getConquered()];
		const progress: Progress = {
			active,
			unlocked: [...this.planetsService.getUnlocked()],
			conquered,
			team: teamAtom(),
			personal: researched,
			discovered: discoveredAtom(),
			bases,
		};

		this.writing = true;
		const written = updateSave(world.save, (old) =>
			old?.code === world.code
				? { ...old, savedAt: os.time(), conquered: conquered.size(), progress }
				: undefined,
		);
		this.writing = false;
		if (!written) this.logger.Warn("World {Code} was not saved", world.code);
	}
}
