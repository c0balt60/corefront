import { MessageEmitter } from "@rbxts/tether";

/**
 * Planet selection in a world server. Every Tether emitter shares one remote,
 * so place message ids start at 100 to stay clear of core's `Message` ids.
 */
export const planetsMessaging = MessageEmitter.create<PlanetsMessageData>();

export const enum PlanetsMessage {
	Request = 100,
	State,
	Deploy,
	Recall,
}

export interface WorldState {
	readonly code: string;
	readonly seed: number;
	readonly isPrivate: boolean;
	/** Indexes into `generateStarSystem(seed).planets` that players may deploy to. */
	readonly unlocked: Array<number>;
	/** Planets the world has liberated. */
	readonly conquered: Array<number>;
	/** The planet everyone plays while a mission is on; players may only deploy there. `undefined`: the next deploy picks it. */
	readonly active?: number;
}

export interface PlanetsMessageData {
	/** Client -> server: the client is listening and wants the world state. */
	[PlanetsMessage.Request]: undefined;
	/** Server -> client: the world, once known, and whenever planets unlock. */
	[PlanetsMessage.State]: WorldState;
	/** Client -> server: spawn me on this planet. */
	[PlanetsMessage.Deploy]: { readonly planet: number };
	/** Server -> client: the mission ended and your character is gone. Back to the star map. */
	[PlanetsMessage.Recall]: undefined;
}
