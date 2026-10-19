import { Dependency } from "@flamework/core";
import type { CommandContext } from "@rbxts/cmdr";

import { TutorialService } from "game/Tutorial/server/TutorialService";
import { stepIndex, TUTORIAL_DONE, TUTORIAL_STEPS, type TutorialStep } from "game/Tutorial/shared/tutorial";

export = function (_context: CommandContext, player: Player, step: string) {
	const progress = step === "done" ? TUTORIAL_DONE : step === "reset" ? 0 : stepIndex(step as TutorialStep);
	if (progress < 0) return `Unknown step "${step}". Try one of: ${TUTORIAL_STEPS.join(", ")}, done, reset.`;

	Dependency<TutorialService>().setProgress(player, progress);
	return `${player.Name} is now at ${step}.`;
};
