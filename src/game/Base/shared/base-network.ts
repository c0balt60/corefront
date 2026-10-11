import { MessageEmitter } from "@rbxts/tether";

import type { BuildableKind } from "game/Base/shared/buildings";
import type { ResourceStack } from "game/Base/shared/resources";

/** The defend mission on the active planet. Ids start at 110, clear of core's and Planets' (100+). */
export const baseMessaging = MessageEmitter.create<BaseMessageData>();

export const enum BaseMessage {
	Request = 110,
	State,
	Inventory,
	Notice,
	Place,
	Remove,
	CallWave,
	Fire,
}

/**
 * - `idle`: no planet is active yet.
 * - `generating`: the active planet's terrain is being written.
 * - `active`: the base is running. Aliens are attacking when `aliens > 0`; a liberated planet has none.
 * - `won` / `lost`: the result banner. A win goes back to `active`, liberated; a loss retreats the team.
 * - `travelling`: the core is launching, in transit or landing. Nothing can be built and the aliens wait.
 */
export type Phase = "idle" | "generating" | "active" | "won" | "lost" | "travelling";

export interface BaseState {
	readonly phase: Phase;
	/** Index into `generateStarSystem(seed).planets`, or -1 while idle. */
	readonly planet: number;
	/** Whether the active planet is liberated: no waves, just the base. */
	readonly liberated: boolean;
	/** Waves launched so far, and how many the planet has. */
	readonly wave: number;
	readonly waves: number;
	/** `Workspace.GetServerTimeNow()` when the next wave launches, or 0 when none is coming. */
	readonly nextWaveAt: number;
	readonly aliens: number;
	readonly coreHealth: number;
	readonly coreMaxHealth: number;
	/** The Core's storage: every resource this planet has, in `RESOURCE_ORDER`, zeros included. */
	readonly pool: ReadonlyArray<ResourceStack>;
	/** The most of each resource deposits can fill the pool to. */
	readonly capacity: number;
}

export interface BaseMessageData {
	/** Client -> server: send me the state and my inventory. */
	[BaseMessage.Request]: undefined;
	/** Server -> client(s): whenever any of it changes. */
	[BaseMessage.State]: BaseState;
	/** Server -> client: what this player carries (non-zero stacks only). */
	[BaseMessage.Inventory]: { readonly items: ReadonlyArray<ResourceStack>; readonly capacity: number };
	/** Server -> client: a short toast, e.g. why a build was refused. */
	[BaseMessage.Notice]: { readonly text: string };
	/** Client -> server: build `kind` with its -X/-Z corner on cell (x, z). `rotation` is quarter turns, 0-3. */
	[BaseMessage.Place]: {
		readonly kind: BuildableKind;
		readonly x: number;
		readonly z: number;
		readonly rotation: number;
	};
	/** Client -> server: remove whichever building covers cell (x, z). */
	[BaseMessage.Remove]: { readonly x: number; readonly z: number };
	/** Client -> server: launch the next wave now. */
	[BaseMessage.CallWave]: undefined;
	/** Client -> server: the equipped Blaster fired at this world point. The server raycasts from the Blaster. */
	[BaseMessage.Fire]: { readonly target: Vector3 };
}
