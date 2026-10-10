import { Players } from "@rbxts/services";
import Vide from "@rbxts/vide";
import { useAtom } from "@rbxts/vide-charm";

import { hudVisibleAtom } from "core/Interface/client/ui-state";
import { ModeSelect } from "lobby/Queue/client/components/mode-select";
import { queuesAtom } from "lobby/Queue/client/queue-state";
import { QueueMessage, queueMessaging } from "lobby/Queue/shared/queue-network";

/**
 * Everything on screen that only exists in the lobby. Core's `App` still draws
 * the shared HUD and loading screen. This is where lobby features' components
 * are wired to their atoms and messages.
 */
export function LobbyApp() {
	const visible = useAtom(hudVisibleAtom);

	return (
		<screengui Name="LobbyApp" Enabled={visible} ResetOnSpawn={false}>
			<ModeSelect
				queues={useAtom(queuesAtom)}
				userId={Players.LocalPlayer.UserId}
				onJoin={(mode) => queueMessaging.server.emit(QueueMessage.Join, { mode })}
				onLeave={() => queueMessaging.server.emit(QueueMessage.Leave)}
			/>
		</screengui>
	);
}
