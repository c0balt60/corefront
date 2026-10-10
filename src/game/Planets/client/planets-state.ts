import { atom } from "@rbxts/charm";

import type { WorldState } from "game/Planets/shared/planets-network";

/** The world as the server last described it. `undefined` until the server knows which world this is. */
export const worldStateAtom = atom<WorldState>();

/** Whether the local player has spawned into the world, so the planet picker is done. */
export const deployedAtom = atom(false);

/** Index of the planet the panel shows, into `generateStarSystem(seed).planets`. */
export const selectedPlanetAtom = atom(0);

/** Index of the planet under the cursor on the star map, if any. */
export const hoveredPlanetAtom = atom<number>();
