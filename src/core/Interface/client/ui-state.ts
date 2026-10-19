import { atom } from "@rbxts/charm";

import { COLORS } from "core/Interface/client/theme";

/**
 * Client UI state lives in Charm atoms like this one. Controllers write to
 * them; components read them through `useAtom` from `@rbxts/vide-charm`.
 */
export const hudVisibleAtom = atom(true);

/** True once core's loading screen has finished and gone. */
export const loadedAtom = atom(false);

/** How strongly `ScreenEffect`'s vignette shows, from 0 (not at all) to 1. Clamped where it's read. */
export const screenEffectIntensityAtom = atom(0);
/** The vignette's tint. The art is plain white, so any colour works. */
export const screenEffectColorAtom = atom(COLORS.danger);
/** How far the vignette throbs, from 0 (held steady) to 1 (fading all the way out and back each beat). */
export const screenEffectPulseAtom = atom(0);
