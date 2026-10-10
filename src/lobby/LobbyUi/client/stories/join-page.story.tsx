import { CreateVideStory, type InferVideProps, Slider } from "@rbxts/ui-labs";
import Vide from "@rbxts/vide";

import { MAX_PLAYERS, type WorldSummary } from "core/Worlds/shared/worlds";
import { MainMenu } from "lobby/Menu/client/components/main-menu";
import { JoinPage } from "lobby/Servers/client/components/join-page";

const controls = {
	worlds: Slider(4, 0, 12, 1),
	players: Slider(2, 1, MAX_PLAYERS, 1),
};

export = CreateVideStory({ controls, vide: Vide }, (props: InferVideProps<typeof controls>) => {
	const worlds = () => {
		const list = new Array<WorldSummary>();
		for (let i = 0; i < props.controls.worlds(); i++) {
			list.push({
				code: "ABC234",
				hostName: `Player${i + 1}`,
				seed: (i + 1) * 104729,
				// Every other world is one fuller, so the full-world JOIN button shows up too.
				players: math.min(props.controls.players() + (i % 2), MAX_PLAYERS),
			});
		}
		return list;
	};

	return (
		<MainMenu page={() => "join"} onPage={(page) => print(`page ${page}`)}>
			<JoinPage
				worlds={worlds}
				onJoin={(code) => print(`join ${code}`)}
				onRefresh={() => print("refresh")}
				onReturn={() => print("return")}
			/>
		</MainMenu>
	);
});
