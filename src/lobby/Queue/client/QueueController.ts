import { Controller, OnStart } from "@flamework/core";

import { queuesAtom } from "lobby/Queue/client/queue-state";
import { QueueMessage, queueMessaging } from "lobby/Queue/shared/queue-network";

/** Keeps `queuesAtom` in sync with the server. The mode picker is mounted by `LobbyUiController`. */
@Controller()
export class QueueController implements OnStart {
	onStart() {
		queueMessaging.client.on(QueueMessage.State, ({ queues }) => queuesAtom(queues));
		queueMessaging.server.emit(QueueMessage.Request);
	}
}
