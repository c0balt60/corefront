import { CreateVideStory, type InferVideProps, Slider } from "@rbxts/ui-labs";
import Vide from "@rbxts/vide";

import { LoadingScreen } from "core/Interface/client/components/loading-screen";

const controls = {
	progress: Slider(0.4, 0, 1, 0.01),
	done: false,
};

export = CreateVideStory({ controls, vide: Vide }, (props: InferVideProps<typeof controls>) => (
	<LoadingScreen progress={props.controls.progress} done={props.controls.done} onFinished={() => print("finished")} />
));
