import { OnStart, Service } from "@flamework/core";
import type { Logger } from "@rbxts/log";
import { Players } from "@rbxts/services";

import { DataService } from "core/Data/server/DataService";
import { IS_STUDIO } from "core/shared/constants";
import { teleport } from "core/Teleport/server/teleport";
import { PLACE_IDS } from "core/Teleport/shared/places";
import { isMatchTeleportData, type MatchTeleportData } from "core/Teleport/shared/teleport-data";

/**
 * The match's teleport receiver and data loader. Each arriving player's teleport
 * data is checked, then their profile is loaded. Once both are done they count
 * as arrived. Anyone who did not come from the lobby is sent back there.
 */
@Service()
export class ArrivalService implements OnStart {
	/** What this server was reserved for. Set by the first player to arrive. */
	private teleportData: MatchTeleportData | undefined;
	private readonly arrived = new Set<Player>();

	constructor(
		private readonly logger: Logger,
		private readonly dataService: DataService,
	) {}

	onStart() {
		const arrive = (player: Player) => this.arrive(player);
		Players.GetPlayers().forEach(arrive);
		Players.PlayerAdded.Connect(arrive);
		Players.PlayerRemoving.Connect((player) => this.arrived.delete(player));
	}

	/** The lobby's teleport data, or `undefined` until the first player arrives. */
	getTeleportData(): MatchTeleportData | undefined {
		return this.teleportData;
	}

	/** Players whose teleport data was valid and whose data has loaded. */
	getArrived(): Array<Player> {
		return [...this.arrived];
	}

	/** Whether everyone the lobby sent has arrived. */
	hasEveryoneArrived(): boolean {
		const expected = this.teleportData?.userIds ?? [];
		return expected.every((userId) => this.getArrived().some((player) => player.UserId === userId));
	}

	private async arrive(player: Player) {
		const data = this.readTeleportData(player);
		if (!data) {
			this.logger.Warn("{Player} did not come from the lobby. Sending them back", player.Name);
			teleport(PLACE_IDS.lobby, [player]);
			return;
		}
		// A reserved server only ever receives one group, so every arrival carries the same data.
		this.teleportData ??= data;

		const profile = await this.dataService.waitForData(player);
		if (!profile) return;

		this.arrived.add(player);
		this.logger.Info("{Player} arrived for {Mode}", player.Name, data.mode);
	}

	private readTeleportData(player: Player): MatchTeleportData | undefined {
		const joinData = player.GetJoinData();
		if (isMatchTeleportData(joinData.TeleportData) && joinData.SourcePlaceId === PLACE_IDS.lobby) {
			return joinData.TeleportData;
		}
		// Studio cannot teleport, so a playtest of this place acts as a practice match.
		if (IS_STUDIO) return { mode: "practice", userIds: [player.UserId] };
		return undefined;
	}
}
