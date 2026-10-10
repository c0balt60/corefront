import { Workspace } from "@rbxts/services";
import { Choose, CreateVideStory, type InferVideProps } from "@rbxts/ui-labs";
import Vide from "@rbxts/vide";

import { MATCH_MODE_IDS } from "core/Teleport/shared/match-modes";
import { MatchHud } from "match/Match/client/components/match-hud";
import type { MatchPhase } from "match/Match/shared/match-network";

const PHASES: Array<MatchPhase> = ["waiting", "playing", "ended"];

const controls = {
	mode: Choose([...MATCH_MODE_IDS]),
	phase: Choose(PHASES),
	joining: false,
};

export = CreateVideStory({ controls, vide: Vide }, (props: InferVideProps<typeof controls>) => {
	// Fixed when the story opens, so the timer ticks down instead of restarting every frame.
	const endsAt = Workspace.GetServerTimeNow() + 60;

	return (
		<MatchHud
			state={() =>
				props.controls.joining()
					? undefined
					: { mode: props.controls.mode(), phase: props.controls.phase(), endsAt }
			}
		/>
	);
});
