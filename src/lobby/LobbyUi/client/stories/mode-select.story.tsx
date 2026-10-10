import { Workspace } from "@rbxts/services";
import { CreateVideStory, type InferVideProps } from "@rbxts/ui-labs";
import Vide from "@rbxts/vide";

import { MATCH_MODE_IDS } from "core/Teleport/shared/match-modes";
import { ModeSelect } from "lobby/Queue/client/components/mode-select";

const LOCAL_USER_ID = 1;

const controls = {
	playersPerQueue: 1,
	joined: true,
	countingDown: true,
};

export = CreateVideStory({ controls, vide: Vide }, (props: InferVideProps<typeof controls>) => {
	// Fixed when the story opens, so the countdown ticks down instead of restarting every frame.
	const launchAt = Workspace.GetServerTimeNow() + 30;

	const queues = () =>
		MATCH_MODE_IDS.map((mode) => {
			const userIds = new Array<number>();
			for (let i = 0; i < props.controls.playersPerQueue(); i++) userIds.push(100 + i);
			// The local player shows as queued for the first mode only.
			if (props.controls.joined() && mode === MATCH_MODE_IDS[0]) userIds.push(LOCAL_USER_ID);
			return { mode, userIds, launchAt: props.controls.countingDown() ? launchAt : undefined };
		});

	return (
		<ModeSelect
			queues={queues}
			userId={LOCAL_USER_ID}
			onJoin={(mode) => print(`join ${mode}`)}
			onLeave={() => print("leave")}
		/>
	);
});
