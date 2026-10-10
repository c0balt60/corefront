import { CreateVideStory, type InferVideProps } from "@rbxts/ui-labs";
import Vide from "@rbxts/vide";

import { CoinCounter } from "core/Interface/client/components/coin-counter";

const controls = {
	coins: 100,
};

export = CreateVideStory({ controls, vide: Vide }, (props: InferVideProps<typeof controls>) => (
	<CoinCounter coins={props.controls.coins} />
));
