import { MessageEmitter } from "@rbxts/tether";

/**
 * Every remote message in the game. Emitters are named after where the
 * message goes: `messaging.server.emit` sends to the server and
 * `messaging.client.emit` sends to a client.
 */
export const messaging = MessageEmitter.create<MessageData>();

export const enum Message {
	SyncRequest,
	SyncDispatch,
}

export interface MessageData {
	/** Client -> server: the client is listening and wants its data. */
	[Message.SyncRequest]: {
		readonly ready: boolean;
	};
	/** Server -> client: Charm Sync payloads. Untyped because a patch has no fixed shape. */
	[Message.SyncDispatch]: {
		readonly payloads: unknown;
	};
}
