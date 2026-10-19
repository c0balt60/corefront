import { OnStart, Service } from "@flamework/core";
import { listen } from "@rbxts/charm";
import type { Logger } from "@rbxts/log";
import { t } from "@rbxts/t";

import { ArrivalService } from "game/Arrival/server/ArrivalService";
import { BaseService } from "game/Base/server/BaseService";
import { isAlienKind, WaveService } from "game/Base/server/WaveService";
import { SandboxMessage, sandboxMessaging } from "game/Base/shared/base-network";
import { ResearchService } from "game/Research/server/ResearchService";

/** The most aliens one Spawn sends. */
const MAX_SPAWN = 50;
/** Seconds between Spawns, from anyone, so a held click can't flood the queue. */
const SPAWN_DEBOUNCE = 0.25;

const isSpawnData = t.interface({ kind: isAlienKind, count: t.integer });

/**
 * Sandbox worlds: everything researched, a pool that never runs down, a Core that can't fall, no
 * waves, and the sandbox panel's controls to send and clear aliens. A world created as a sandbox
 * starts as one; the `sandbox` command turns any server into one.
 */
@Service()
export class SandboxService implements OnStart {
	private lastSpawn = -math.huge;

	constructor(
		private readonly logger: Logger,
		private readonly arrivalService: ArrivalService,
		private readonly baseService: BaseService,
		private readonly waveService: WaveService,
		private readonly researchService: ResearchService,
	) {}

	onStart() {
		listen(this.arrivalService.worldAtom, (world) => {
			if (world?.sandbox !== undefined && !this.baseService.sandbox()) this.start();
		});

		sandboxMessaging.server.on(SandboxMessage.Spawn, (player, data) => {
			if (!this.baseService.sandbox() || !isSpawnData(data)) return;
			if (os.clock() - this.lastSpawn < SPAWN_DEBOUNCE) return;
			this.lastSpawn = os.clock();
			const count = math.clamp(data.count, 1, MAX_SPAWN);
			if (this.waveService.queue(data.kind, count)) {
				this.logger.Info("{Player} spawned {Count} {Kind}", player.Name, count, data.kind);
			}
		});
		sandboxMessaging.server.on(SandboxMessage.Clear, () => {
			if (this.baseService.sandbox()) this.waveService.clearAliens();
		});
	}

	/** Turns this server into a sandbox, for good. */
	start() {
		// Research first: it raises the Core's capacity, which the pool fills to.
		this.researchService.researchAll();
		this.baseService.startSandbox();
		this.waveService.startSandbox();
		this.logger.Info("Sandbox on");
	}
}
