import { atom, computed } from "@rbxts/charm";

import { playerDataAtom } from "core/Data/client/data-state";
import { baseStateAtom } from "game/Base/client/base-state";
import { isUnlocked, TUTORIAL_DONE, type TutorialLock } from "game/Tutorial/shared/tutorial";

/** This player's tutorial progress (see `TUTORIAL_STEPS`): done in a sandbox, and 0 until their data arrives. */
export const tutorialProgressAtom = computed(() =>
	baseStateAtom()?.sandbox ? TUTORIAL_DONE : (playerDataAtom()?.tutorial ?? 0),
);

/** Whether this player may use `lock` yet. Reactive. */
export function unlockedAtom(lock: TutorialLock): boolean {
	return isUnlocked(tutorialProgressAtom(), lock);
}

/** What the tutorial is asking of the player right now. */
export interface TutorialHint {
	/** The step it is for, an index into `TUTORIAL_STEPS`. */
	readonly step: number;
	readonly title: string;
	readonly text: string;
	/** A line of how far along they are, like what they hold of what it costs. */
	readonly progress?: string;
	/** The part of the interface to point at, if any. */
	readonly gui?: GuiObject;
	/** The thing in the world to point at and outline, if any. */
	readonly world?: PVInstance;
}

/** The current hint (`TutorialController` sets it), or `undefined` when there's no tutorial to show. */
export const tutorialHintAtom = atom<TutorialHint>();
