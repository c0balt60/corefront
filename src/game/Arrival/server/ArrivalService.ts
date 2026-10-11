import { OnStart, Service } from "@flamework/core";
import { atom } from "@rbxts/charm";
import type { Logger } from "@rbxts/log";
import { Players } from "@rbxts/services";

import { DataService } from "core/Data/server/DataService";
import { IS_STUDIO } from "core/shared/constants";
import { teleport } from "core/Teleport/server/teleport";
import { PLACE_IDS } from "core/Teleport/shared/places";
import { isWorldTeleportData } from "core/Teleport/shared/teleport-data";
import { getWorld, removeWorld, setWorldPlayers } from "core/Worlds/server/registry";
import type { PlanetKind } from "core/Worlds/shared/star-system";
import { isValidCode, randomSeed } from "core/Worlds/shared/worlds";

/** The world this server runs, as the registry describes it. */
export interface World {
	readonly code: string;
	readonly seed: number;
	readonly isPrivate: boolean;
	/** A sandbox world's one planet's kind (see `generateStarSystem`). Undefined for a campaign. */
	readonly sandbox?: PlanetKind;
}

/** Seconds between registry refreshes. The registry drops an entry that goes quiet for longer than that. */
const REGISTRY_REFRESH = 30;

/**
 * The world server's teleport receiver and data loader. The first player sent by
 * the lobby decides which world this server runs: the join code in their teleport
 * data must match a registry entry that belongs to this very server. Everyone else
 * must carry the same code, or goes back to the lobby. Players count as arrived
 * once their profile has loaded too.
 */
@Service()
export class ArrivalService implements OnStart {
	/** The world, once known. Read it with `getWorld`, or subscribe to react when it becomes known. Do not write it. */
	readonly worldAtom = atom<World>();
	/** The one registry lookup, shared by everyone who arrives while it runs. */
	private lookup: Promise<World | undefined> | undefined;
	private readonly arrived = new Set<Player>();

	constructor(
		private readonly logger: Logger,
		private readonly dataService: DataService,
	) {}

	onStart() {
		if (IS_STUDIO) {
			// Studio can neither teleport nor reach the registry, so a playtest is a world of its own.
			this.worldAtom({ code: "STUDIO", seed: randomSeed(), isPrivate: false });
		} else {
			Players.PlayerAdded.Connect(() => this.refreshRegistry());
			Players.PlayerRemoving.Connect((player) => this.refreshRegistry(player));
			task.spawn(() => {
				while (true) {
					task.wait(REGISTRY_REFRESH);
					this.refreshRegistry();
				}
			});
			game.BindToClose(() => {
				const world = this.worldAtom();
				if (world) removeWorld(world.code);
			});
		}

		const arrive = (player: Player) => this.arrive(player);
		Players.GetPlayers().forEach(arrive);
		Players.PlayerAdded.Connect(arrive);
		Players.PlayerRemoving.Connect((player) => this.arrived.delete(player));
	}

	/** The world this server runs, or `undefined` until the first player has been checked. */
	getWorld(): World | undefined {
		return this.worldAtom();
	}

	/** Whether a player belongs in this world and their data has loaded. */
	isArrived(player: Player): boolean {
		return this.arrived.has(player);
	}

	private async arrive(player: Player) {
		const admitted = await this.admit(player);
		if (!admitted || player.Parent !== Players) return;

		const data = await this.dataService.waitForData(player);
		if (!data || player.Parent !== Players) return;

		this.arrived.add(player);
		this.logger.Info("{Player} arrived in world {Code}", player.Name, this.worldAtom()?.code);
	}

	/** Whether a player belongs in this world. Anyone who does not is sent back to the lobby. */
	private async admit(player: Player): Promise<boolean> {
		if (IS_STUDIO) return true;

		const join = player.GetJoinData();
		const data: unknown = join.TeleportData;
		if (join.SourcePlaceId === PLACE_IDS.lobby && isWorldTeleportData(data) && isValidCode(data.code)) {
			// The first valid arrival looks the world up; anyone arriving meanwhile waits on that same lookup.
			this.lookup ??= Promise.try(() => this.lookupWorld(data.code));
			const lookup = this.lookup;
			const world = await lookup;
			// No world means the lookup failed: forget it so the next arrival tries again.
			if (!world && this.lookup === lookup) this.lookup = undefined;
			if (world?.code === data.code) return true;
		}

		this.logger.Warn("{Player} does not belong in this world. Sending them back", player.Name);
		teleport(PLACE_IDS.lobby, [player]);
		return false;
	}

	/** Reads the world from the registry, if the entry is the one reserved for this server, and starts hosting it. */
	private lookupWorld(code: string): World | undefined {
		const entry = getWorld(code);
		if (!entry || entry.privateServerId !== game.PrivateServerId) return undefined;

		const world: World = { code, seed: entry.seed, isPrivate: entry.isPrivate, sandbox: entry.sandbox };
		this.worldAtom(world);
		this.logger.Info(
			"Hosting world {Code} (seed {Seed}, private {Private}, sandbox {Sandbox})",
			code,
			world.seed,
			world.isPrivate,
			world.sandbox,
		);
		task.spawn(() => this.refreshRegistry());
		return world;
	}

	/** Writes the player count, which also renews the registry entry. `leaving` is still listed during `PlayerRemoving`. */
	private refreshRegistry(leaving?: Player) {
		const world = this.worldAtom();
		if (!world) return;

		const players = Players.GetPlayers().filter((player) => player !== leaving);
		setWorldPlayers(world.code, players.size());
	}
}
