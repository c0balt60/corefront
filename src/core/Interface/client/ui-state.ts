import { atom } from "@rbxts/charm";

/**
 * Client UI state lives in Charm atoms like this one. Controllers write to
 * them; components read them through `useAtom` from `@rbxts/vide-charm`.
 */
export const hudVisibleAtom = atom(true);
