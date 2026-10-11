import { MessageEmitter } from "@rbxts/tether";

import type { ResourceStack } from "game/Base/shared/resources";

/**
 * Planet selection in a world server. Every Tether emitter shares one remote,
 * so place message ids start at 100 to stay clear of core's `Message` ids.
 */
export const planetsMessaging = MessageEmitter.create<PlanetsMessageData>();

export const enum PlanetsMessage {
	Request = 100,
	State,
	Deploy,
	Propose,
	Ready,
	Cancel,
}

/** Seconds each half of the travel cutscene lasts: the core lifting off, and the core coming down. */
export const LAUNCH_SECONDS = 4;
export const LAND_SECONDS = 4;

/**
 * The team on its way between planets. `launch`: the core lifts off the old one.
 * `transit`: the new planet's terrain is generating. `land`: the core comes down on it.
 * A retreat (the core destroyed, or the planet abandoned) skips `launch`.
 */
export interface Travel {
	readonly from: number;
	readonly to: number;
	readonly stage: "launch" | "transit" | "land";
}

/**
 * Where the team goes when it leaves planet `from` with enemies still on it, or
 * loses its Core there: the nearest liberated planet by orbit, the inner one on a
 * tie, or else the first planet. `count` is how many planets the system has.
 */
export function retreatTarget(conquered: ReadonlyArray<number>, from: number, count: number): number {
	for (let distance = 1; distance < count; distance++) {
		for (const planet of [from - distance, from + distance]) if (conquered.includes(planet)) return planet;
	}
	return 0;
}

/** A launch someone has set up, waiting for every deployed player to ready up. */
export interface LaunchPlan {
	readonly planet: number;
	/** Loaded from the pool on top of the fuel. It lands with the core. */
	readonly cargo: ReadonlyArray<ResourceStack>;
	/** Leaving a planet enemies still hold: the core is destroyed and the team retreats to `planet`. */
	readonly abandon: boolean;
	/** UserIds of the players who have readied up, and of every player who must. */
	readonly ready: ReadonlyArray<number>;
	readonly needed: ReadonlyArray<number>;
}

export interface WorldState {
	readonly code: string;
	readonly seed: number;
	readonly isPrivate: boolean;
	/** Indexes into `generateStarSystem(seed).planets` that players may travel to. */
	readonly unlocked: Array<number>;
	/** Planets the world has liberated. */
	readonly conquered: Array<number>;
	/** The planet the team is on; players who haven't deployed yet may only deploy there. */
	readonly active?: number;
	readonly travel?: Travel;
	readonly plan?: LaunchPlan;
}

export interface PlanetsMessageData {
	/** Client -> server: the client is listening and wants the world state. */
	[PlanetsMessage.Request]: undefined;
	/** Server -> client: the world, once known, and whenever it changes. */
	[PlanetsMessage.State]: WorldState;
	/** Client -> server: spawn me on this planet. */
	[PlanetsMessage.Deploy]: { readonly planet: number };
	/** Client -> server: set up a launch to `planet` with this cargo, or, on a planet enemies hold, a retreat. */
	[PlanetsMessage.Propose]: { readonly planet: number; readonly cargo: ReadonlyArray<ResourceStack> };
	/** Client -> server: I'm ready for the launch that's set up. */
	[PlanetsMessage.Ready]: undefined;
	/** Client -> server: call the launch off. */
	[PlanetsMessage.Cancel]: undefined;
}
