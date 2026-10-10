import { OnStart, Service } from "@flamework/core";
import { server as syncServer } from "@rbxts/charm-sync";
import { Players } from "@rbxts/services";

import { DataService } from "core/Data/server/DataService";
import { getDataSyncKey } from "core/Data/shared/player-data";
import { Message, messaging } from "core/shared/network";

/**
 * Replicates each player's data to that player only. Charm Sync sends the
 * whole table once, then only the fields that changed.
 *
 * Clients ask for their data instead of being pushed it on join, because a
 * payload sent before the client is listening is lost.
 */
@Service()
export class ReplicationService implements OnStart {
	private readonly subscribed = new Set<Player>();

	constructor(private readonly dataService: DataService) {}

	onStart() {
		syncServer.connect((player, payloads) => {
			messaging.client.emit(player, Message.SyncDispatch, { payloads });
		});

		messaging.server.on(Message.SyncRequest, (player) => {
			if (this.subscribed.has(player)) return;
			this.subscribed.add(player);
			// The selector reads `undefined` until the profile loads, then syncs it automatically.
			syncServer.addSignalsToClient(player, {
				[getDataSyncKey(player.UserId)]: this.dataService.selectData(player),
			});
		});

		Players.PlayerRemoving.Connect((player) => {
			this.subscribed.delete(player);
			syncServer.removeClient(player);
		});
	}
}
