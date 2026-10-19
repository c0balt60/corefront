import { OnStart, Service } from "@flamework/core";
import { subscribe } from "@rbxts/charm";
import type { Logger } from "@rbxts/log";
import { HttpService, Players } from "@rbxts/services";

import { IS_STUDIO } from "core/shared/constants";
import { TerrainService } from "game/Terrain/server/TerrainService";
import { sanitizeConfig } from "game/Terrain/shared/config";
import { TerrainMessage, terrainMessaging } from "game/Terrain/shared/terrain-network";

const APPLY_COOLDOWN = 1;
/** Seconds between progress updates while a planet generates. */
const PROGRESS_INTERVAL = 0.25;

/** Anyone in Studio, or the owner of a user-owned place. */
function isTrusted(player: Player): boolean {
	return IS_STUDIO || (game.CreatorType === Enum.CreatorType.User && player.UserId === game.CreatorId);
}

/**
 * Server end of the terrain debug panel (F4). Only trusted players get answers
 * or may regenerate; everyone else is ignored silently. Applied configs are
 * sanitized against the schema before they reach the generator.
 */
@Service()
export class TerrainDebugService implements OnStart {
	private readonly lastApply = new Map<Player, number>();
	private progressQueued = false;

	constructor(
		private readonly logger: Logger,
		private readonly terrainService: TerrainService,
	) {}

	onStart() {
		terrainMessaging.server.on(TerrainMessage.DebugRequest, (player) => {
			if (isTrusted(player)) {
				terrainMessaging.client.emit(player, TerrainMessage.DebugState, this.terrainService.statusAtom());
			}
		});
		terrainMessaging.server.on(TerrainMessage.DebugApply, (player, data) => this.apply(player, data));

		// Completion goes out at once; progress at most every PROGRESS_INTERVAL.
		subscribe(this.terrainService.statusAtom, (state) => {
			if (!state.generating) return this.broadcast();
			if (this.progressQueued) return;
			this.progressQueued = true;
			task.delay(PROGRESS_INTERVAL, () => {
				this.progressQueued = false;
				this.broadcast();
			});
		});

		Players.PlayerRemoving.Connect((player) => this.lastApply.delete(player));
	}

	private apply(player: Player, data: unknown) {
		if (!isTrusted(player)) return;
		const now = os.clock();
		if (now - (this.lastApply.get(player) ?? -math.huge) < APPLY_COOLDOWN) return;
		this.lastApply.set(player, now);

		const json = typeIs(data, "table") ? (data as { config?: unknown }).config : undefined;
		if (!typeIs(json, "string")) return;
		const [ok, input] = pcall(() => HttpService.JSONDecode(json));
		if (!ok) return;

		this.logger.Info("{Player} regenerated the planet from the terrain debug panel", player.Name);
		this.terrainService.regenerate(sanitizeConfig(input, this.terrainService.getConfig()));
		this.broadcast();
	}

	private broadcast() {
		const trusted = Players.GetPlayers().filter(isTrusted);
		if (trusted.size() === 0) return;
		terrainMessaging.client.emit(trusted, TerrainMessage.DebugState, this.terrainService.statusAtom());
	}
}
