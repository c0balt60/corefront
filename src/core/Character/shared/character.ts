import type { EvaluateInstanceTree } from "@rbxts/validate-tree";

/** The parts of a character the game relies on. Add to it as you need more. */
export const CharacterSchema = {
	$className: "Model",
	Humanoid: {
		$className: "Humanoid",
		Animator: "Animator",
	},
	HumanoidRootPart: "BasePart",
} as const;

export type CharacterRig = EvaluateInstanceTree<typeof CharacterSchema>;
