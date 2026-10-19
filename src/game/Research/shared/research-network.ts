import { MessageEmitter } from "@rbxts/tether";

import type { ResourceId } from "game/Base/shared/resources";
import type { ResearchId } from "game/Research/shared/research";

/** Each player's research tree. Ids start at 130, clear of Base's messages (110 to 125) and clear of its belt, shot and sandbox ones (140+). */
export const researchMessaging = MessageEmitter.create<ResearchMessageData>();

export const enum ResearchMessage {
	Request = 130,
	State,
	Research,
}

export interface ResearchState {
	/** This player's research, the team's included. Nodes at 0 are left out. */
	readonly levels: ReadonlyArray<{ readonly id: ResearchId; readonly level: number }>;
	/** Every resource the Core has held, which some nodes wait on. */
	readonly discovered: ReadonlyArray<ResourceId>;
}

export interface ResearchMessageData {
	/** Client -> server: send me my research. */
	[ResearchMessage.Request]: undefined;
	/** Server -> client: whenever this player's research, or the team's, changes. */
	[ResearchMessage.State]: ResearchState;
	/** Client -> server: research the next level of `id`, paid from the Core. */
	[ResearchMessage.Research]: { readonly id: ResearchId };
}
