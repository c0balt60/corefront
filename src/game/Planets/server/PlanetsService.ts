import { OnStart, Service } from "@flamework/core";
import { atom, computed, listen, subscribe } from "@rbxts/charm";
import type { Logger } from "@rbxts/log";
import { Players } from "@rbxts/services";
import { t } from "@rbxts/t";

import { generateStarSystem, type Planet } from "core/Worlds/shared/star-system";
import { ArrivalService } from "game/Arrival/server/ArrivalService";
import { PlanetsMessage, planetsMessaging, type WorldState } from "game/Planets/shared/planets-network";
import type { PlanetMap } from "game/Terrain/server/planet-map";
import { TerrainService } from "game/Terrain/server/TerrainService";

const isDeployData = t.interface({ planet: t.integer });

/** Players appear this far from the landing, so never inside the Core, and this high above the ground. */
const SPAWN_RADIUS = 14;
const SPAWN_HEIGHT = 5;

/**
 * The world's campaign. One planet is active at a time: players may only
 * deploy there, and spawn and respawn at its landing. Winning it conquers it,
 * unlocks the next and recalls everyone to the star map; the next deploy picks
 * the new active planet. `CharacterAutoLoads` is off in this place (see
 * `places/game/.rogen.json`), so characters only ever come from here.
 */
@Service()
export class PlanetsService implements OnStart {
	/** The planet being played, or `undefined` while players choose the next. Only this service writes it. */
	readonly activeAtom = atom<number>();
	/** The active planet's map, once generated. Each new one is a fresh planet. */
	readonly currentMap = computed(() => {
		const map = this.terrainService.mapAtom();
		return map && map.planet === this.activeAtom() ? map : undefined;
	});
	private readonly unlocked = [0];
	private readonly conquered = new Array<number>();
	private readonly deployed = new Set<Player>();

	constructor(
		private readonly logger: Logger,
		private readonly arrivalService: ArrivalService,
		private readonly terrainService: TerrainService,
	) {}

	onStart() {
		planetsMessaging.server.on(PlanetsMessage.Request, (player) => {
			const state = this.getState();
			if (state) planetsMessaging.client.emit(player, PlanetsMessage.State, state);
		});
		planetsMessaging.server.on(PlanetsMessage.Deploy, (player, data) => this.deploy(player, data));

		// Every world starts on its first planet, generated as soon as the world is known.
		listen(this.arrivalService.worldAtom, (world) => {
			if (world) this.activate(0);
		});

		// A regenerated map moves the landing: bring everyone standing on the old one to the new.
		subscribe(this.currentMap, (map) => {
			if (!map) return;
			for (const player of this.deployed) {
				const character = player.Character;
				const humanoid = character?.FindFirstChildOfClass("Humanoid");
				if (character && humanoid && humanoid.Health > 0) this.pivot(character, map);
			}
		});

		Players.PlayerRemoving.Connect((player) => this.deployed.delete(player));
	}

	/** A planet of this world's star system, once the world is known. */
	getPlanet(index: number): Planet | undefined {
		const world = this.arrivalService.getWorld();
		return world && generateStarSystem(world.seed).planets[index];
	}

	/** Marks the active planet conquered, unlocks the next one and sends everyone back to the star map. */
	conquer() {
		const planet = this.activeAtom();
		if (planet === undefined) return;
		if (!this.conquered.includes(planet)) this.conquered.push(planet);
		if (this.getPlanet(planet + 1) && !this.unlocked.includes(planet + 1)) this.unlocked.push(planet + 1);

		// Forget them first, so a character dying as it is removed does not respawn.
		const recalled = [...this.deployed];
		this.deployed.clear();
		for (const player of recalled) {
			player.Character?.Destroy();
			player.Character = undefined;
		}
		this.activeAtom(undefined);
		this.broadcast();
		if (!recalled.isEmpty()) planetsMessaging.client.emit(recalled, PlanetsMessage.Recall);
		this.logger.Info("Planet {Planet} conquered", planet);
	}

	/** Gives every deployed player a fresh character at the landing. */
	respawnAll() {
		for (const player of this.deployed) task.spawn(() => this.spawn(player));
	}

	private getState(): WorldState | undefined {
		const world = this.arrivalService.getWorld();
		return (
			world && {
				...world,
				unlocked: [...this.unlocked],
				conquered: [...this.conquered],
				active: this.activeAtom(),
			}
		);
	}

	private broadcast() {
		const state = this.getState();
		if (state) planetsMessaging.client.emitAll(PlanetsMessage.State, state);
	}

	private activate(planet: number) {
		this.activeAtom(planet);
		// Deferred, so generation never runs inside a Charm callback or before every service has started.
		task.defer(() => this.terrainService.generate(planet));
		this.broadcast();
		this.logger.Info("Planet {Planet} is now active", planet);
	}

	private deploy(player: Player, data: unknown) {
		if (!this.arrivalService.isArrived(player) || this.deployed.has(player)) return;
		if (!isDeployData(data) || !this.unlocked.includes(data.planet) || this.conquered.includes(data.planet)) return;

		const active = this.activeAtom();
		if (active === undefined) this.activate(data.planet);
		else if (active !== data.planet) return;

		this.deployed.add(player);
		this.logger.Info("{Player} deployed to planet {Planet}", player.Name, data.planet);
		task.spawn(() => this.spawn(player));
	}

	/** Waits for the map, then loads the player's character at the landing. They respawn there after dying. */
	private spawn(player: Player) {
		// ponytail: polls for the map; a Charm subscription if spawns ever need to be instant.
		while (this.deployed.has(player) && !this.currentMap()) task.wait(0.25);
		if (!this.deployed.has(player)) return;

		player.LoadCharacter();
		const character = player.Character;
		const humanoid = character?.FindFirstChildOfClass("Humanoid");
		if (!character || !humanoid) return;
		// LoadCharacter yields, and the map may have gone meanwhile. The new one re-pivots everyone.
		const map = this.currentMap();
		if (map) this.pivot(character, map);

		humanoid.Died.Connect(() => {
			task.delay(Players.RespawnTime, () => {
				if (player.Character === character && this.deployed.has(player)) this.spawn(player);
			});
		});
	}

	private pivot(character: Model, map: PlanetMap) {
		const angle = math.random() * 2 * math.pi;
		const x = map.landing.X + math.cos(angle) * SPAWN_RADIUS;
		const z = map.landing.Z + math.sin(angle) * SPAWN_RADIUS;
		const position = new Vector3(x, map.heightAt(x, z) + SPAWN_HEIGHT, z);
		character.PivotTo(CFrame.lookAt(position, new Vector3(map.landing.X, position.Y, map.landing.Z)));
	}
}
