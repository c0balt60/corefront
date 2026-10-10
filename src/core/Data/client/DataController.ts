import { Controller, OnStart } from "@flamework/core";
import { client as syncClient, type SyncPayload } from "@rbxts/charm-sync";
import { Players } from "@rbxts/services";

import { playerDataAtom } from "core/Data/client/data-state";
import { getDataSyncKey } from "core/Data/shared/player-data";
import { Message, messaging } from "core/shared/network";

@Controller({ loadOrder: 0 })
export class DataController implements OnStart {
	onStart() {
		syncClient.addSignals({ [getDataSyncKey(Players.LocalPlayer.UserId)]: playerDataAtom });

		messaging.client.on(Message.SyncDispatch, ({ payloads }) => {
			syncClient.patch(payloads as Array<SyncPayload>);
		});

		messaging.server.emit(Message.SyncRequest, { ready: true });
	}
}
