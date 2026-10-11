import { atom } from "@rbxts/charm";

import type { TerrainDebugState } from "game/Terrain/shared/terrain-network";

/** Whether the debug panel is toggled open (F4). */
export const terrainDebugOpenAtom = atom(false);

/** The generator as the server last described it. Stays `undefined` for players the server doesn't trust. */
export const terrainDebugAtom = atom<TerrainDebugState>();
