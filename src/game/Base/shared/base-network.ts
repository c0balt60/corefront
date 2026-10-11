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
 * - `idle`: no planet is active (players are choosing one).
 * - `generating`: the active planet's terrain is being written.
 * - `active`: the mission is on. Aliens are attacking when `aliens > 0`.
 * - `won` / `lost`: the result banner, until players are recalled or the planet resets.
 */
export type Phase = "idle" | "generating" | "active" | "won" | "lost";

export interface BaseState {
	readonly phase: Phase;
	/** Index into `generateStarSystem(seed).planets`, or -1 while idle. */
	readonly planet: number;
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
