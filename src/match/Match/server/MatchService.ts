import { OnStart, Service } from "@flamework/core";
import type { Logger } from "@rbxts/log";
import { Players, Workspace } from "@rbxts/services";

import { DataService } from "core/Data/server/DataService";
import { teleport } from "core/Teleport/server/teleport";
import { MATCH_MODES, type MatchModeId } from "core/Teleport/shared/match-modes";
import { PLACE_IDS } from "core/Teleport/shared/places";
import { ArrivalService } from "match/Arrival/server/ArrivalService";
import { type MatchPhase, type MatchState, MatchMessage, matchMessaging } from "match/Match/shared/match-network";

/** Seconds to wait for everyone the lobby sent before starting without the stragglers. */
const ARRIVAL_TIMEOUT = 30;
/** Seconds the results stay up before everyone returns to the lobby. */
const RESULTS_LENGTH = 10;
const REWARD_COINS = 10;

/**
 * Runs this server's one round: wait for arrivals, play, reward, then send
 * everyone back to the lobby. A reserved server closes once it is empty.
 */
@Service()
export class MatchService implements OnStart {
	private state: MatchState | undefined;

	constructor(
		private readonly logger: Logger,
		private readonly arrivalService: ArrivalService,
		private readonly dataService: DataService,
	) {}

	onStart() {
		matchMessaging.server.on(MatchMessage.Request, (player) => {
			// Before the first arrival there is no state yet. The first `setPhase` reaches everyone.
			if (this.state) matchMessaging.client.emit(player, MatchMessage.State, this.state);
		});
		task.spawn(() => this.run());
	}

	private run() {
		while (!this.arrivalService.getTeleportData()) task.wait(0.5);
		const { mode } = this.arrivalService.getTeleportData()!;

		this.setPhase("waiting", mode, ARRIVAL_TIMEOUT);
		const deadline = os.clock() + ARRIVAL_TIMEOUT;
		while (!this.arrivalService.hasEveryoneArrived() && os.clock() < deadline) task.wait(0.5);

		// TODO: spawn at team or map spawn points, and decide what happens to players who arrive late.
		for (const player of this.arrivalService.getArrived()) task.spawn(() => player.LoadCharacter());

		const { roundLength } = MATCH_MODES[mode];
		this.setPhase("playing", mode, roundLength);
		// TODO: the actual game. End the round early once a win condition is met, and pick the winners.
		task.wait(roundLength);

		for (const player of this.arrivalService.getArrived()) {
			this.dataService.update(player, (data) => ({
				...data,
				coins: data.coins + REWARD_COINS,
				matchesPlayed: data.matchesPlayed + 1,
			}));
		}
		this.setPhase("ended", mode, RESULTS_LENGTH);
		task.wait(RESULTS_LENGTH);

		// Leaving ends each player's session, which saves the rewards before the lobby loads them.
		teleport(PLACE_IDS.lobby, Players.GetPlayers());
	}

	private setPhase(phase: MatchPhase, mode: MatchModeId, length: number) {
		this.state = { phase, mode, endsAt: Workspace.GetServerTimeNow() + length };
		this.logger.Info("Match {Mode} is now {Phase}", mode, phase);
		matchMessaging.client.emitAll(MatchMessage.State, this.state);
	}
}
