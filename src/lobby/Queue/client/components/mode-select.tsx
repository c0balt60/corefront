import Vide from "@rbxts/vide";

import { useServerTime } from "core/Interface/client/use-server-time";
import { MATCH_MODE_IDS, MATCH_MODES, type MatchModeId } from "core/Teleport/shared/match-modes";
import type { QueueSnapshot } from "lobby/Queue/shared/queue-network";

interface ModeSelectProps {
	readonly queues: () => ReadonlyArray<QueueSnapshot>;
	/** The local player, to tell which queue they are in. */
	readonly userId: number;
	readonly onJoin: (mode: MatchModeId) => void;
	readonly onLeave: () => void;
}

/** One button per match mode, showing its queue size and countdown. Clicking joins or leaves that queue. */
export function ModeSelect({ queues, userId, onJoin, onLeave }: ModeSelectProps) {
	const now = useServerTime();

	return (
		<frame
			Name="ModeSelect"
			AnchorPoint={new Vector2(1, 0.5)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={1}
			Position={new UDim2(1, -16, 0.5, 0)}
			Size={UDim2.fromOffset(280, 0)}
		>
			<uilistlayout Padding={new UDim(0, 8)} SortOrder={Enum.SortOrder.LayoutOrder} />

			{MATCH_MODE_IDS.map((mode, index) => {
				const { name, maxPlayers } = MATCH_MODES[mode];
				const queue = () => queues().find((snapshot) => snapshot.mode === mode);
				const queued = () => queue()?.userIds.includes(userId) ?? false;

				const text = () => {
					const snapshot = queue();
					const count = `${snapshot?.userIds.size() ?? 0}/${maxPlayers}`;
					const launchAt = snapshot?.launchAt;
					const countdown = launchAt !== undefined ? ` - ${math.max(0, math.ceil(launchAt - now()))}s` : "";
					return `${queued() ? "Leave" : "Join"} ${name} (${count})${countdown}`;
				};

				return (
					<textbutton
						BackgroundColor3={() => (queued() ? new Color3(0.2, 0.5, 0.3) : new Color3(0, 0, 0))}
						BackgroundTransparency={0.3}
						Font={Enum.Font.GothamBold}
						LayoutOrder={index}
						Size={new UDim2(1, 0, 0, 48)}
						Text={text}
						TextColor3={new Color3(1, 1, 1)}
						TextSize={20}
						Activated={() => (queued() ? onLeave() : onJoin(mode))}
					>
						<uicorner CornerRadius={new UDim(0, 8)} />
					</textbutton>
				);
			})}
		</frame>
	);
}
