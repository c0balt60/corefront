import { CreateVideStory, type InferVideProps } from "@rbxts/ui-labs";
import Vide from "@rbxts/vide";

import { generateStarSystem } from "core/Worlds/shared/star-system";
import { PlanetPanel } from "game/Planets/client/components/planet-panel";

const controls = {
	planet: 0,
	seed: 12345,
	unlocked: true,
};

export = CreateVideStory({ controls, vide: Vide }, (props: InferVideProps<typeof controls>) => {
	const planet = () => {
		const { planets } = generateStarSystem(props.controls.seed());
		return planets[math.clamp(math.floor(props.controls.planet()), 0, planets.size() - 1)];
	};

	return <PlanetPanel planet={planet} unlocked={props.controls.unlocked} onDeploy={() => print("deploy")} />;
});
