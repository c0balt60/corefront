import { atom } from "@rbxts/charm";

import type { ResourceId } from "game/Base/shared/resources";
import type { Levels } from "game/Research/shared/research";

/** The local player's research, the team's included, as the server last sent it. */
export const levelsAtom = atom<Levels>({});

/** Every resource the Core has held. */
export const discoveredAtom = atom<ReadonlyArray<ResourceId>>([]);

/** Whether the research tree is open. */
export const researchOpenAtom = atom(false);

/** The Research button in the top bar, once `ResearchController` has made it. */
export const researchIconAtom = atom<GuiObject>();
