import { OnStart, Service } from "@flamework/core";
import { subscribe } from "@rbxts/charm";
import type { Logger } from "@rbxts/log";
import { Players } from "@rbxts/services";
import { t } from "@rbxts/t";

import { ArrivalService } from "game/Arrival/server/ArrivalService";
import { PlanetsMessage, planetsMessaging, type WorldState } from "game/Planets/shared/planets-network";

const isDeployData = t.interface({ planet: t.integer });

/**
 * Tells players about the world and spawns them on a planet when they deploy.
 * `CharacterAutoLoads` is off in this place (see `places/game/.rogen.json`), so a
 * player only gets a character once they pick a planet, and respawns from here.
 */
@Service()
export class PlanetsService implements OnStart {
	// TODO: unlock a planet once the world conquers it, then send everyone the new state.
	private readonly unlocked = [0];
	private readonly deployed = new Set<Player>();

	constructor(
		private readonly logger: Logger,
		private readonly arrivalService: ArrivalService,
	) {}

	onStart() {
		planetsMessaging.server.on(PlanetsMessage.Request, (player) => {
			const state = this.getState();
			if (state) planetsMessaging.client.emit(player, PlanetsMessage.State, state);
		});
		planetsMessaging.server.on(PlanetsMessage.Deploy, (player, data) => this.deploy(player, data));

		// Clients that asked before the world was known get it the moment it is.
		subscribe(this.arrivalService.worldAtom, () => {
			const state = this.getState();
			if (state) planetsMessaging.client.emitAll(PlanetsMessage.State, state);
		});

		Players.PlayerRemoving.Connect((player) => this.deployed.delete(player));
	}

	private getState(): WorldState | undefined {
		const world = this.arrivalService.getWorld();
		return world && { ...world, unlocked: [...this.unlocked] };
	}

	private deploy(player: Player, data: unknown) {
		if (!this.arrivalService.isArrived(player) || this.deployed.has(player)) return;
		if (!isDeployData(data) || !this.unlocked.includes(data.planet)) return;

		this.deployed.add(player);
		this.logger.Info("{Player} deployed to planet {Planet}", player.Name, data.planet);

		player.CharacterAdded.Connect((character) => {
			const humanoid = character.WaitForChild("Humanoid") as Humanoid;
			humanoid.Died.Connect(() => {
				task.delay(Players.RespawnTime, () => {
					if (player.Parent === Players) player.LoadCharacter();
				});
			});
		});

		// TODO: generate the planet's terrain with terrain-generator from `planets[data.planet].terrainSeed`
		// (`generateStarSystem(world.seed)`) and spawn the player there. For now: the place's SpawnLocation.
		task.spawn(() => player.LoadCharacter());
	}
}
