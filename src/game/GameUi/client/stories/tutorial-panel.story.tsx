import { CreateVideStory, type InferVideProps } from "@rbxts/ui-labs";
import Vide from "@rbxts/vide";

import { TutorialPanel } from "game/Tutorial/client/components/tutorial-panel";
import { TUTORIAL_STEPS } from "game/Tutorial/shared/tutorial";

const controls = {
	step: 4,
	title: "RESEARCH THE TURRET",
	text: "Research costs Core resources. Press T to open Research",
	progress: "Copper 34/20 · Lead 6/10",
	show: true,
};

export = CreateVideStory({ controls, vide: Vide }, (props: InferVideProps<typeof controls>) => (
	<TutorialPanel
		step={props.controls.step}
		steps={TUTORIAL_STEPS.size()}
		title={props.controls.title}
		text={props.controls.text}
		progress={props.controls.progress}
		onSkip={() => print("skip")}
		show={props.controls.show}
	/>
));
