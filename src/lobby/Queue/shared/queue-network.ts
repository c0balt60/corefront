import { MessageEmitter } from "@rbxts/tether";

import type { MatchModeId } from "core/Teleport/shared/match-modes";

/**
 * Lobby queue messages. Every Tether emitter shares one remote, so place
 * message ids start at 100 to stay clear of core's `Message` ids.
 */
export const queueMessaging = MessageEmitter.create<QueueMessageData>();

export const enum QueueMessage {
	Join = 100,
	Leave,
	Request,
	State,
}

export interface QueueSnapshot {
	readonly mode: MatchModeId;
	readonly userIds: Array<number>;
	/** Server time (`Workspace.GetServerTimeNow`) the queue launches at, while its countdown runs. */
	readonly launchAt?: number;
}

export interface QueueMessageData {
	/** Client -> server: join a mode's queue, leaving any other. */
	[QueueMessage.Join]: { readonly mode: MatchModeId };
	/** Client -> server: leave whichever queue the player is in. */
	[QueueMessage.Leave]: undefined;
	/** Client -> server: the client is listening and wants the current queues. */
	[QueueMessage.Request]: undefined;
	/** Server -> client: every queue, in `MATCH_MODE_IDS` order. */
	[QueueMessage.State]: { readonly queues: Array<QueueSnapshot> };
}
