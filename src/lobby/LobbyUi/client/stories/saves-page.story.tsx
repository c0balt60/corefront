import { CreateVideStory, type InferVideProps, Slider } from "@rbxts/ui-labs";
import Vide from "@rbxts/vide";

import { type SaveSummary, SLOT_COUNT } from "core/Worlds/shared/worlds";
import { MainMenu } from "lobby/Menu/client/components/main-menu";
import { SavesPage } from "lobby/Servers/client/components/saves-page";

const controls = {
	filled: Slider(2, 0, SLOT_COUNT, 1),
};

export = CreateVideStory({ controls, vide: Vide }, (props: InferVideProps<typeof controls>) => {
	const saves = () => {
		const list = new Array<SaveSummary>();
		for (let slot = 1; slot <= props.controls.filled(); slot++) {
			list.push({
				slot,
				// The second is a sandbox and the third set by hand, to show each kind of slot.
				settings:
					slot === 2
						? { seed: slot * 104729, sandbox: "Volcanic" }
						: { seed: slot * 104729, difficulty: slot === 3 ? 4 : undefined },
				isPrivate: slot === 3,
				conquered: slot,
				savedAt: os.time() - slot * 3600,
			});
		}
		return list;
	};

	return (
		<MainMenu page={() => "saves"} onPage={(page) => print(`page ${page}`)}>
			<SavesPage
				saves={saves}
				onLoad={(slot) => print(`load ${slot}`)}
				onCreate={(slot) => print(`create in ${slot}`)}
				onDelete={(slot) => print(`delete ${slot}`)}
				onRefresh={() => print("refresh")}
				onReturn={() => print("return")}
			/>
		</MainMenu>
	);
});
