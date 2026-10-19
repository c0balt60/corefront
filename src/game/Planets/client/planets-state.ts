import { atom } from "@rbxts/charm";

import type { WorldState } from "game/Planets/shared/planets-network";

/** The world as the server last described it. `undefined` until the server knows which world this is. */
export const worldStateAtom = atom<WorldState>();

/** Whether the local player has spawned into the world, so the planet picker is done. */
export const deployedAtom = atom(false);

/** Whether a deployed player has the star map open. */
export const starMapOpenAtom = atom(false);

/** The planet the local player is loading a launch for, before proposing it. */
export const composingAtom = atom<number>();

/** Index of the planet the panel shows, into `generateStarSystem(seed).planets`. */
export const selectedPlanetAtom = atom(0);

/** Index of the planet under the cursor on the star map, if any. */
export const hoveredPlanetAtom = atom<number>();

/** The Star Map button in the top bar, once `PlanetsController` has made it. */
export const starMapIconAtom = atom<GuiObject>();
