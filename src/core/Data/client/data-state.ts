import { atom } from "@rbxts/charm";

import type { PlayerData } from "core/Data/shared/player-data";

/** This client's copy of its own data, kept in sync by `DataController`. `undefined` until it arrives. */
export const playerDataAtom = atom<PlayerData | undefined>(undefined);
