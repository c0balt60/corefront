import { atom } from "@rbxts/charm";

import type { MatchState } from "match/Match/shared/match-network";

/** The match's current phase, kept in sync by `MatchController`. `undefined` until the server sends it. */
export const matchStateAtom = atom<MatchState | undefined>(undefined);
