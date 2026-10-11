import { OnStart, Service } from "@flamework/core";
import { atom, computed, listen, subscribe } from "@rbxts/charm";
import type { Logger } from "@rbxts/log";
import { Players } from "@rbxts/services";
import { t } from "@rbxts/t";

import { generateStarSystem, type Planet } from "core/Worlds/shared/star-system";
import { ArrivalService } from "game/Arrival/server/ArrivalService";
import {
	type LaunchPlan,
	PlanetsMessage,
	planetsMessaging,
	type Travel,
	type WorldState,
} from "game/Planets/shared/planets-network";
import type { PlanetMap } from "game/Terrain/server/planet-map";
import { TerrainService } from "game/Terrain/server/TerrainService";

const isDeployData = t.interface({ planet: t.integer });

/** Players appear this far from the landing, so never inside the Core, and this high above the ground. */
const SPAWN_RADIUS = 14;
const SPAWN_HEIGHT = 5;

/**
 * The world's campaign. One planet is active at a time: the team is there, and
 * players who haven't deployed yet may only deploy there. Characters spawn and
 * respawn at its landing. Winning it conquers it and unlocks the next; the team
 * stays until `TravelService` moves it. `CharacterAutoLoads` is off in this place
 * (see `places/game/.rogen.json`), so characters only ever come from here.
 */
@Service()
export class PlanetsService implements OnStart {
	/** The planet the team is on. Only this service writes it. */
	readonly activeAtom = atom<number>();
	/** The active planet's map, once generated. Each new one is a fresh planet. */
	readonly currentMap = computed(() => {
		const map = this.terrainService.mapAtom();
		return map && map.planet === this.activeAtom() ? map : undefined;
	});
	/** The team between planets. `TravelService` writes it. */
	readonly travelAtom = atom<Travel>();
	/** The launch waiting on ready-ups. `TravelService` writes it; `needed` is filled in here. */
	readonly planAtom = atom<Omit<LaunchPlan, "needed">>();
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

		// Characters stand still, anchored, from lift-off until the core has landed.
		subscribe(
			() => this.travelAtom() !== undefined,
			(travelling) => {
				for (const player of this.deployed) if (player.Character) this.hold(player.Character, travelling);
			},
		);
		subscribe(this.travelAtom, () => this.broadcast());
		subscribe(this.planAtom, () => this.broadcast());

		Players.PlayerRemoving.Connect((player) => {
			this.deployed.delete(player);
			this.broadcast();
		});
	}

	/** A planet of this world's star system, once the world is known. */
	getPlanet(index: number): Planet | undefined {
		return this.getPlanets()[index];
	}

	getPlanets(): ReadonlyArray<Planet> {
		const world = this.arrivalService.getWorld();
		return world ? generateStarSystem(world.seed, world.sandbox).planets : [];
	}

	isConquered(planet: number): boolean {
		return this.conquered.includes(planet);
	}

	getConquered(): ReadonlyArray<number> {
		return this.conquered;
	}

	isUnlocked(planet: number): boolean {
		return this.unlocked.includes(planet);
	}

	isDeployed(player: Player): boolean {
		return this.deployed.has(player);
	}

	/** UserIds of everyone on the planet, who must all ready up for a launch. */
	getDeployedIds(): Array<number> {
		return [...this.deployed].map((player) => player.UserId);
	}

	/** Marks the active planet conquered and unlocks the next one. The team stays. */
	conquer() {
		const planet = this.activeAtom();
		if (planet === undefined) return;
		if (!this.conquered.includes(planet)) this.conquered.push(planet);
		if (this.getPlanet(planet + 1) && !this.unlocked.includes(planet + 1)) this.unlocked.push(planet + 1);
		this.broadcast();
		this.logger.Info("Planet {Planet} conquered", planet);
	}

	/** Makes `planet` the active one and (re)generates its terrain, even if it already was. Deployed players come along. */
	activate(planet: number) {
		this.activeAtom(planet);
		// Deferred, so generation never runs inside a Charm callback or before every service has started.
		task.defer(() => this.terrainService.generate(planet));
		this.broadcast();
		this.logger.Info("Planet {Planet} is now active", planet);
	}

	private getState(): WorldState | undefined {
		const world = this.arrivalService.getWorld();
		const plan = this.planAtom();
		return (
			world && {
				...world,
				unlocked: [...this.unlocked],
				conquered: [...this.conquered],
				active: this.activeAtom(),
				travel: this.travelAtom(),
				plan: plan && { ...plan, needed: this.getDeployedIds() },
			}
		);
	}

	private broadcast() {
		const state = this.getState();
		if (state) planetsMessaging.client.emitAll(PlanetsMessage.State, state);
	}

	private deploy(player: Player, data: unknown) {
		if (!this.arrivalService.isArrived(player) || this.deployed.has(player)) return;
		if (!isDeployData(data) || data.planet !== this.activeAtom()) return;

		this.deployed.add(player);
		this.broadcast();
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
		if (this.travelAtom()) this.hold(character, true);

		humanoid.Died.Connect(() => {
			task.delay(Players.RespawnTime, () => {
				if (player.Character === character && this.deployed.has(player)) this.spawn(player);
			});
		});
	}

	private hold(character: Model, held: boolean) {
		const root = character.FindFirstChild("HumanoidRootPart");
		if (root?.IsA("BasePart")) root.Anchored = held;
	}

	private pivot(character: Model, map: PlanetMap) {
		const angle = math.random() * 2 * math.pi;
		const x = map.landing.X + math.cos(angle) * SPAWN_RADIUS;
		const z = map.landing.Z + math.sin(angle) * SPAWN_RADIUS;
		const position = new Vector3(x, map.heightAt(x, z) + SPAWN_HEIGHT, z);
		character.PivotTo(CFrame.lookAt(position, new Vector3(map.landing.X, position.Y, map.landing.Z)));
	}
}
