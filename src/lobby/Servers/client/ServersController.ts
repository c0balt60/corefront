import { Controller, OnStart } from "@flamework/core";
import { subscribe } from "@rbxts/charm";

import { savesAtom, statusAtom, worldsAtom } from "lobby/Servers/client/servers-state";
import { ServersMessage, serversMessaging } from "lobby/Servers/shared/servers-network";

/** Seconds a create, load, join or delete may take before the player is told it timed out. */
const BUSY_TIMEOUT = 30;

/**
 * Keeps `worldsAtom`, `savesAtom` and `statusAtom` in sync with the server. The pages are mounted by `LobbyUiController`.
 * A successful create, load or join sends no message, because the player teleports away.
 */
@Controller()
export class ServersController implements OnStart {
	onStart() {
		serversMessaging.client.on(ServersMessage.List, ({ worlds }) => worldsAtom(worlds));
		serversMessaging.client.on(ServersMessage.Saves, ({ saves }) => {
			savesAtom(saves);
			// The only thing busy that ends with the slots is a delete.
			if (statusAtom().kind === "busy") statusAtom({ kind: "idle" });
		});
		serversMessaging.client.on(ServersMessage.Failed, ({ reason }) => statusAtom({ kind: "error", text: reason }));

		let timeout: thread | undefined;
		subscribe(statusAtom, (status) => {
			if (timeout) task.cancel(timeout);
			timeout = undefined;
			if (status.kind !== "busy") return;

			timeout = task.delay(BUSY_TIMEOUT, () => {
				timeout = undefined;
				statusAtom({ kind: "error", text: "Timed out. Try again." });
			});
		});
	}
}
