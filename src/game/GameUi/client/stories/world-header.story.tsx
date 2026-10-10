import { CreateVideStory, type InferVideProps } from "@rbxts/ui-labs";
import Vide from "@rbxts/vide";

import { WorldHeader } from "game/Planets/client/components/world-header";

const controls = {
	star: "Kepler-186",
	code: "K7P2XQ",
	isPrivate: true,
};

export = CreateVideStory({ controls, vide: Vide }, (props: InferVideProps<typeof controls>) => (
	<WorldHeader star={props.controls.star} code={props.controls.code} isPrivate={props.controls.isPrivate} />
));
