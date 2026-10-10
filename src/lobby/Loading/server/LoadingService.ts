import { OnStart, Service } from "@flamework/core";
import type { Logger } from "@rbxts/log";
import { Players } from "@rbxts/services";

import { DataService } from "core/Data/server/DataService";

/**
 * The lobby's data loader. `CharacterAutoLoads` is off in this place (see
 * `places/lobby/.rogen.json`), so a player spawns only once their profile has
 * loaded, and respawns from here when they die.
 */
@Service()
export class LoadingService implements OnStart {
	private readonly loaded = new Set<Player>();

	constructor(
		private readonly logger: Logger,
		private readonly dataService: DataService,
	) {}

	onStart() {
		const load = (player: Player) => this.load(player);
		Players.GetPlayers().forEach(load);
		Players.PlayerAdded.Connect(load);
		Players.PlayerRemoving.Connect((player) => this.loaded.delete(player));
	}

	/** Whether a player's data has loaded and they have spawned. */
	isLoaded(player: Player): boolean {
		return this.loaded.has(player);
	}

	private async load(player: Player) {
		const data = await this.dataService.waitForData(player);
		if (!data) return;

		// TODO: lobby setup that needs saved data (cosmetics, daily rewards, returning-from-match rewards, ...).
		this.logger.Info("{Player} loaded into the lobby ({Matches} matches played)", player.Name, data.matchesPlayed);

		player.CharacterAdded.Connect((character) => {
			const humanoid = character.WaitForChild("Humanoid") as Humanoid;
			humanoid.Died.Connect(() => {
				task.delay(Players.RespawnTime, () => {
					if (player.Parent === Players) player.LoadCharacter();
				});
			});
		});

		this.loaded.add(player);
		player.LoadCharacter();
	}
}
