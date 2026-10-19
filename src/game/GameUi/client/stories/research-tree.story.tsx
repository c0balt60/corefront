import { CreateVideStory, type InferVideProps } from "@rbxts/ui-labs";
import Vide, { source } from "@rbxts/vide";

import { ResearchTree } from "game/Research/client/components/research-tree";
import { type Levels, maxLevel, RESEARCH_ORDER } from "game/Research/shared/research";

const controls = {
	conquered: 0,
	titanium: false,
	copper: 200,
	lead: 100,
};

export = CreateVideStory({ controls, vide: Vide }, (props: InferVideProps<typeof controls>) => {
	// Clicking Research levels the node up here, with no server to ask.
	const levels = source<Levels>({});

	return (
		<ResearchTree
			levels={levels}
			core={() => "core"}
			gates={() => ({
				conquered: props.controls.conquered(),
				discovered: props.controls.titanium() ? ["copper", "lead", "titanium"] : ["copper", "lead"],
			})}
			pool={() => [
				{ resource: "copper", amount: props.controls.copper() },
				{ resource: "lead", amount: props.controls.lead() },
				{ resource: "titanium", amount: props.controls.titanium() ? 100 : 0 },
			]}
			onResearch={(id) => {
				const level = levels()[id] ?? 0;
				if (RESEARCH_ORDER.includes(id) && level < maxLevel(id)) levels({ ...levels(), [id]: level + 1 });
			}}
			onClose={() => print("close")}
			show={() => true}
		/>
	);
});
