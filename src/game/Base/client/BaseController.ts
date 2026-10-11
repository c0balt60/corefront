import { Controller, OnStart } from "@flamework/core";

import { baseStateAtom, inventoryAtom, NOTICE_SECONDS, type Notice, noticesAtom } from "game/Base/client/base-state";
import { BaseMessage, baseMessaging } from "game/Base/shared/base-network";

/** The most toasts on screen at once. A new one pushes the oldest out. */
const MAX_NOTICES = 4;

/** Keeps the mission atoms in sync with the server. `GameApp` draws them. */
@Controller()
export class BaseController implements OnStart {
	onStart() {
		baseMessaging.client.on(BaseMessage.State, (state) => baseStateAtom(state));
		baseMessaging.client.on(BaseMessage.Inventory, (inventory) => inventoryAtom(inventory));
		baseMessaging.client.on(BaseMessage.Notice, ({ text }) => {
			const notice: Notice = { text };
			noticesAtom((notices) => [...notices, notice].filter((_, index, all) => index >= all.size() - MAX_NOTICES));
			task.delay(NOTICE_SECONDS, () => noticesAtom((notices) => notices.filter((other) => other !== notice)));
		});
		baseMessaging.server.emit(BaseMessage.Request);
	}
}
