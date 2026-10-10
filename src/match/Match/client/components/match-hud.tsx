import Vide from "@rbxts/vide";

import { useServerTime } from "core/Interface/client/use-server-time";
import { MATCH_MODES } from "core/Teleport/shared/match-modes";
import type { MatchPhase, MatchState } from "match/Match/shared/match-network";

const PHASE_TEXT: Record<MatchPhase, string> = {
	waiting: "Waiting for players",
	playing: "In progress",
	ended: "Match over, returning to lobby",
};

interface MatchHudProps {
	readonly state: () => MatchState | undefined;
}

/** The mode, phase and time left in the current phase. */
export function MatchHud({ state }: MatchHudProps) {
	const now = useServerTime();

	const text = () => {
		const current = state();
		if (!current) return "Joining match...";
		const secondsLeft = math.max(0, math.ceil(current.endsAt - now()));
		return `${MATCH_MODES[current.mode].name}: ${PHASE_TEXT[current.phase]} (${secondsLeft}s)`;
	};

	return (
		<textlabel
			Name="MatchHud"
			AnchorPoint={new Vector2(0.5, 0)}
			BackgroundColor3={new Color3(0, 0, 0)}
			BackgroundTransparency={0.4}
			Font={Enum.Font.GothamBold}
			Position={new UDim2(0.5, 0, 0, 72)}
			Size={UDim2.fromOffset(420, 40)}
			Text={text}
			TextColor3={new Color3(1, 1, 1)}
			TextSize={20}
		>
			<uicorner CornerRadius={new UDim(0, 8)} />
		</textlabel>
	);
}
