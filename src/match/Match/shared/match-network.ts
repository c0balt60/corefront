import { MessageEmitter } from "@rbxts/tether";

import type { MatchModeId } from "core/Teleport/shared/match-modes";

/**
 * Match messages. Every Tether emitter shares one remote, so place message ids
 * start at 100 to stay clear of core's `Message` ids.
 */
export const matchMessaging = MessageEmitter.create<MatchMessageData>();

export const enum MatchMessage {
	Request = 100,
	State,
}

export type MatchPhase = "waiting" | "playing" | "ended";

export interface MatchState {
	readonly phase: MatchPhase;
	readonly mode: MatchModeId;
	/** Server time (`Workspace.GetServerTimeNow`) the current phase ends at. */
	readonly endsAt: number;
}

export interface MatchMessageData {
	/** Client -> server: the client is listening and wants the match state. */
	[MatchMessage.Request]: undefined;
	/** Server -> client: the phase changed. */
	[MatchMessage.State]: MatchState;
}
