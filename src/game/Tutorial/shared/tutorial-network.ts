import { MessageEmitter } from "@rbxts/tether";

/** The tutorial's messages. Ids start at 170, clear of Base's (110 to 160). */
export const tutorialMessaging = MessageEmitter.create<TutorialMessageData>();

export const enum TutorialMessage {
	Advance = 170,
	Skip,
}

export interface TutorialMessageData {
	/** Client -> server: the player finished step `step` (an index into `TUTORIAL_STEPS`). Ignored unless it is their current one. */
	[TutorialMessage.Advance]: { readonly step: number };
	/** Client -> server: the player skips the rest of the tutorial. */
	[TutorialMessage.Skip]: undefined;
}
