import { atom } from "@rbxts/charm";

import type { QueueSnapshot } from "lobby/Queue/shared/queue-network";

/** Every queue in the lobby, kept in sync by `QueueController`. */
export const queuesAtom = atom<ReadonlyArray<QueueSnapshot>>([]);
