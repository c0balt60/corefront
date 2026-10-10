import { OnStart, Service } from "@flamework/core";
import type { Logger } from "@rbxts/log";
import { Players, Workspace } from "@rbxts/services";

import { teleport } from "core/Teleport/server/teleport";
import { MATCH_MODE_IDS, MATCH_MODES, type MatchModeId } from "core/Teleport/shared/match-modes";
import { PLACE_IDS } from "core/Teleport/shared/places";
import type { MatchTeleportData } from "core/Teleport/shared/teleport-data";
import { LoadingService } from "lobby/Loading/server/LoadingService";
import { type QueueSnapshot, QueueMessage, queueMessaging } from "lobby/Queue/shared/queue-network";

/** Seconds a queue counts down after reaching its mode's `minPlayers`. */
const COUNTDOWN = 10;

interface Queue {
	readonly players: Array<Player>;
	launchAt?: number;
}

/**
 * One queue per match mode. A queue counts down once it has enough players and
 * launches when the countdown ends or it fills up. Launching reserves a fresh
 * match server and teleports the whole group there with `MatchTeleportData`.
 */
@Service()
export class QueueService implements OnStart {
	private readonly queues = new Map<MatchModeId, Queue>();

	constructor(
		private readonly logger: Logger,
		private readonly loadingService: LoadingService,
	) {}

	onStart() {
		for (const mode of MATCH_MODE_IDS) this.queues.set(mode, { players: [] });

		queueMessaging.server.on(QueueMessage.Join, (player, { mode }) => this.join(player, mode));
		queueMessaging.server.on(QueueMessage.Leave, (player) => this.leave(player));
		queueMessaging.server.on(QueueMessage.Request, (player) => {
			queueMessaging.client.emit(player, QueueMessage.State, { queues: this.snapshot() });
		});
		Players.PlayerRemoving.Connect((player) => this.leave(player));

		task.spawn(() => {
			while (true) {
				task.wait(0.5);
				this.launchDueQueues();
			}
		});
	}

	private join(player: Player, mode: MatchModeId) {
		if (!this.loadingService.isLoaded(player)) return;

		const queue = this.queues.get(mode)!;
		if (queue.players.includes(player) || queue.players.size() >= MATCH_MODES[mode].maxPlayers) return;

		this.leave(player);
		queue.players.push(player);
		this.refresh(mode);
	}

	private leave(player: Player) {
		for (const [mode, queue] of this.queues) {
			const index = queue.players.indexOf(player);
			if (index === -1) continue;
			queue.players.remove(index);
			this.refresh(mode);
		}
	}

	/** Starts or cancels a queue's countdown after its players change, and tells every client. */
	private refresh(mode: MatchModeId) {
		const queue = this.queues.get(mode)!;
		const { minPlayers, maxPlayers } = MATCH_MODES[mode];
		const count = queue.players.size();
		const now = Workspace.GetServerTimeNow();

		if (count >= maxPlayers) queue.launchAt = now;
		else if (count < minPlayers) queue.launchAt = undefined;
		else queue.launchAt ??= now + COUNTDOWN;

		queueMessaging.client.emitAll(QueueMessage.State, { queues: this.snapshot() });
	}

	private launchDueQueues() {
		const now = Workspace.GetServerTimeNow();
		for (const [mode, queue] of this.queues) {
			if (queue.launchAt !== undefined && now >= queue.launchAt) this.launch(mode);
		}
	}

	private launch(mode: MatchModeId) {
		const queue = this.queues.get(mode)!;
		const players = [...queue.players];
		queue.players.clear();
		this.refresh(mode);

		const data: MatchTeleportData = { mode, userIds: players.map((player) => player.UserId) };
		const options = new Instance("TeleportOptions");
		options.ShouldReserveServer = true;
		options.SetTeleportData(data);

		this.logger.Info("Launching {Mode} with {Count} players", mode, players.size());
		task.spawn(() => {
			// The group has left the queue either way, so after a failed teleport they can queue again.
			// TODO: tell the players when their match could not start.
			teleport(PLACE_IDS.match, players, options);
		});
	}

	private snapshot(): Array<QueueSnapshot> {
		return MATCH_MODE_IDS.map((mode) => {
			const queue = this.queues.get(mode)!;
			return { mode, userIds: queue.players.map((player) => player.UserId), launchAt: queue.launchAt };
		});
	}
}
