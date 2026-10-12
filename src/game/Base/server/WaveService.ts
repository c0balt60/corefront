import { OnStart, Service } from "@flamework/core";
import { atom, computed, listen, subscribe } from "@rbxts/charm";
import type { Logger } from "@rbxts/log";
import { Players, RunService, Workspace } from "@rbxts/services";

import { BaseService, type Building } from "game/Base/server/BaseService";
import { buildFlowfield, terrainCosts } from "game/Base/server/flowfield";
import { alienModel, setHealth, shieldBubble, tracer } from "game/Base/server/models";
import {
	ALIEN_KINDS,
	type AlienKind,
	BaseMessage,
	baseMessaging,
	type BaseState,
	ShotMessage,
	shotMessaging,
} from "game/Base/shared/base-network";
import { BUILDINGS, type BuildingDef, DROP_ZONE_RADIUS } from "game/Base/shared/buildings";
import { RESOURCE_ORDER } from "game/Base/shared/resources";
import { PlanetsService } from "game/Planets/server/PlanetsService";
import { TravelService } from "game/Planets/server/TravelService";
import { statOf, teamStat } from "game/Research/server/research-store";
import type { PlanetMap } from "game/Terrain/server/planet-map";
import { CELL_STUDS, cellAt, cellCenter, GRID_SIZE } from "game/Terrain/shared/map";

export const isAlienKind = (value: unknown): value is AlienKind => ALIEN_KINDS.includes(value as AlienKind);

/**
 * How an alien fights:
 * - `melee`: hits the players it reaches, and chews through buildings in its way.
 * - `explode`: like melee, but its first hit blows it up, hurting everything within `splash`.
 * - `shoot`: stops to shoot the nearest player or building within `range`.
 * - `shell`: stops to lob a shell at the nearest player or building within `range`, blasting `splash` round where it lands.
 * - `bomb`: never stops; drops a bomb whenever a building is under it, blasting `splash` round.
 * - `rocket`: stops to fire a pair of rockets at the nearest turret within `range`, or with none
 *   the nearest player or building, each blasting `splash` round where it lands.
 * - `drop`: never stops; drops crawlers from its `cargo` every `rate` seconds until it's empty.
 */
type Attack = "melee" | "explode" | "shoot" | "shell" | "bomb" | "rocket" | "drop";

interface AlienDef {
	readonly health: number;
	/** Studs per second. */
	readonly speed: number;
	/** Per hit, to buildings and players alike. */
	readonly damage: number;
	/** Seconds between hits. */
	readonly rate: number;
	readonly attack: Attack;
	/** Melee reach past the edge of what it hits, in studs. */
	readonly reach?: number;
	/** Height of the body's centre above the ground. */
	readonly hover: number;
	/** Ranged aliens stop this far out to shoot. */
	readonly range?: number;
	/** Studs round where its explosion, shell or bomb goes off that it hurts. */
	readonly splash?: number;
	/** Flies straight for the Core over everything, and only turrets that shoot fliers can hit it. */
	readonly air?: true;
	/** Shielders: their bubble's radius, in studs, and the damage it soaks before it breaks (see `absorb`). */
	readonly shield?: { readonly radius: number; readonly health: number };
	/** Carriers: the crawlers aboard. */
	readonly cargo?: number;
}

const ALIENS: Record<AlienKind, AlienDef> = {
	crawler: { health: 30, speed: 14, damage: 6, rate: 0.8, attack: "melee", reach: 4, hover: 1.5 },
	sapper: { health: 40, speed: 16, damage: 70, rate: 0, attack: "explode", reach: 3, hover: 1.2, splash: 10 },
	brute: { health: 240, speed: 6, damage: 40, rate: 1.6, attack: "melee", reach: 6, hover: 1.9 },
	spitter: { health: 50, speed: 9, damage: 10, rate: 1.5, attack: "shoot", reach: 4, hover: 2.8, range: 36 },
	// Outranges the Turret and Auto-Turret.
	mortar: { health: 200, speed: 5, damage: 35, rate: 4, attack: "shell", reach: 6, hover: 2.5, range: 72, splash: 8 },
	shielder: {
		health: 220,
		speed: 7,
		damage: 4,
		rate: 1,
		attack: "melee",
		reach: 4,
		hover: 1.4,
		shield: { radius: 16, health: 400 },
	},
	titan: { health: 2500, speed: 3.5, damage: 150, rate: 2, attack: "melee", reach: 9, hover: 8.8 },
	drone: { health: 35, speed: 18, damage: 5, rate: 0.6, attack: "shoot", hover: 16, range: 30, air: true },
	bomber: { health: 260, speed: 8, damage: 30, rate: 1.2, attack: "bomb", hover: 22, splash: 9, air: true },
	// Outranges the Turret and Auto-Turret, not the Scatter or Vulcan.
	gunship: {
		health: 700,
		speed: 7,
		damage: 30,
		rate: 3,
		attack: "rocket",
		hover: 26,
		range: 64,
		splash: 6,
		air: true,
	},
	carrier: { health: 600, speed: 6, damage: 0, rate: 5, attack: "drop", hover: 24, cargo: 8, air: true },
};

/** A shielder's shield. It's down while `broken`, until it's back to `SHIELD_REARM` of its `max`. */
interface Shield {
	health: number;
	broken: boolean;
	/** `os.clock()` when it last soaked a hit: it only recharges `SHIELD_DELAY` after. */
	hitAt: number;
	readonly max: number;
	readonly bubble: BasePart;
}

interface Alien {
	readonly model: Model;
	readonly root: BasePart;
	readonly def: AlienDef;
	readonly maxHealth: number;
	health: number;
	x: number;
	z: number;
	/**
	 * A fixed nudge off each cell centre, so a swarm doesn't walk in single file.
	 * ponytail: aliens never push each other apart, so crowds overlap; add separation if that reads badly.
	 */
	readonly offset: Vector3;
	facing: Vector3;
	/** Fliers: their height, which climbs ahead of rising ground, and how far they're tipped nose up, in radians. */
	y: number;
	pitch: number;
	/** Studs per second, as it last moved: where flak leads it. */
	velocity: Vector3;
	cooldown: number;
	/** Ranged aliens: what they are shooting at. They stand still while they have it. */
	aim?: Vector3;
	readonly shield?: Shield;
	/** Carriers: the crawlers still aboard. */
	cargo: number;
}

/** A turret's rocket or shell, or an alien's shell or bomb, in the air (see `Shot`). It lands at `lands`, an `os.clock()` time. */
interface Projectile {
	/** Where it lands: its target's position, while that lives. */
	to: Vector3;
	readonly target?: Alien;
	readonly lands: number;
	readonly damage: number;
	readonly splash: number;
	/** A turret's: the aliens it can hit (see `canHit`). */
	readonly targets?: "air" | "ground";
	/** An alien's: it hurts buildings and players instead. */
	readonly hostile?: true;
}

const GRACE_SECONDS = 90;
const WAVE_SECONDS = 60;
const CALL_DEBOUNCE = 2;
const MAX_ALIENS = 80;
const SPAWN_SECONDS = 0.1;
const SPAWN_SPREAD = 6;
const RESULT_SECONDS = 8;
const FIELD_SECONDS = 0.5;
const STATE_SECONDS = 0.2;
const ENEMY_TRACER = Color3.fromRGB(255, 70, 60);
/** How fast rockets and shells fly, in studs per second, after a moment to clear the turret. */
const ROCKET_SPEED = 90;
const SHELL_SPEED = 110;
const LAUNCH_SECONDS = 0.3;
/** How fast flak flies, in studs per second: straight there, no launch. */
const FLAK_SPEED = 160;
/** Seconds a bomber's bomb takes to fall. */
const BOMB_SECONDS = 0.6;
/** Seconds between the shots of a turret's burst. */
const BURST_SECONDS = 0.4;
/** A turret that spins up fires at this share of its full rate from a standstill, and winds all the way down in this many seconds. */
const SPIN_SLOWEST = 0.2;
const SPIN_DOWN_SECONDS = 1.5;
/** Fliers climb for the ground this far ahead of them, easing to their height and pitch at these rates per second. */
const AIR_LOOKAHEAD = 16;
const CLIMB_RATE = 2.5;
const PITCH_RATE = 4;
/** The furthest a flier tips nose up or down. */
const MAX_PITCH = math.rad(35);
/**
 * Shield regained per second once it's gone this many seconds without a hit, and the share of its
 * max a broken shield needs back before it holds again.
 */
const SHIELD_REGEN = 40;
const SHIELD_DELAY = 2;
const SHIELD_REARM = 0.5;
/** Crawlers a carrier drops at a time. */
const DROP_COUNT = 2;

const random = new Random();

/**
 * Which aliens wave `wave` (from 1) sends: a growing swarm, sappers from wave 2, brutes and drones
 * from wave 3, spitters and shielders from wave 4, mortars from wave 6, bombers from wave 7,
 * gunships from wave 8 and carriers from wave 9. The `final` wave brings a Titan.
 */
function composition(wave: number, final: boolean): Array<AlienKind> {
	const kinds = new Array<AlienKind>();
	const add = (kind: AlienKind, count: number) => {
		for (let i = 0; i < count; i++) kinds.push(kind);
	};
	add("crawler", 4 + 2 * wave);
	add("sapper", math.floor(wave / 2));
	add("brute", math.floor((wave - 1) / 2));
	add("drone", wave - 2);
	add("spitter", wave - 3);
	add("shielder", math.floor((wave - 2) / 2));
	add("mortar", math.floor((wave - 4) / 2));
	add("bomber", math.floor((wave - 5) / 2));
	add("gunship", math.floor((wave - 6) / 2));
	add("carrier", math.floor((wave - 7) / 2));
	add("titan", final ? 1 : 0);
	return kinds;
}

/** Whether a turret that shoots `targets` (both, when undefined) can hit `alien`. */
function canHit(targets: "air" | "ground" | undefined, alien: Alien): boolean {
	return targets === undefined || (targets === "air") === (alien.def.air === true);
}

/** How far either side the ground normal is measured: about half an alien's length, so its ends follow the slope. */
const TILT_REACH = 3;

/** An alien's body: `hover` above the ground along its normal, leaning with the slope and looking along `facing`. */
function groundFrame(map: PlanetMap, x: number, z: number, hover: number, facing: Vector3): CFrame {
	const up = new Vector3(
		map.heightAt(x - TILT_REACH, z) - map.heightAt(x + TILT_REACH, z),
		2 * TILT_REACH,
		map.heightAt(x, z - TILT_REACH) - map.heightAt(x, z + TILT_REACH),
	).Unit;
	// `facing` is level and `up` never is, so this never collapses to zero.
	const forward = facing.sub(up.mul(facing.Dot(up))).Unit;
	const position = new Vector3(x, map.heightAt(x, z), z).add(up.mul(hover));
	return CFrame.fromMatrix(position, forward.Cross(up), up);
}

/** Where an alien's body goes: on the ground (see `groundFrame`), or for a flier at its height, tipped by its pitch. */
function bodyFrame(map: PlanetMap, alien: Alien): CFrame {
	if (!alien.def.air) return groundFrame(map, alien.x, alien.z, alien.def.hover, alien.facing);
	const position = new Vector3(alien.x, alien.y, alien.z);
	return CFrame.lookAt(position, position.add(alien.facing)).mul(CFrame.Angles(alien.pitch, 0, 0));
}

/**
 * Eases a flier toward `hover` above the higher of the ground under it and the ground ahead, so it
 * climbs before a hill and drops after one, and tips it to the slope of the way it just went.
 */
function fly(map: PlanetMap, alien: Alien, from: Vector3, dt: number) {
	const ahead = alien.facing.mul(AIR_LOOKAHEAD);
	const ground = math.max(map.heightAt(alien.x, alien.z), map.heightAt(alien.x + ahead.X, alien.z + ahead.Z));
	alien.y += (ground + alien.def.hover - alien.y) * math.min(dt * CLIMB_RATE, 1);
	const across = math.sqrt((alien.x - from.X) ** 2 + (alien.z - from.Z) ** 2);
	// Level while it hovers in place.
	const slope = across > 1e-3 ? math.clamp(math.atan2(alien.y - from.Y, across), -MAX_PITCH, MAX_PITCH) : 0;
	alien.pitch += (slope - alien.pitch) * math.min(dt * PITCH_RATE, 1);
}

/**
 * A shield left alone for `SHIELD_DELAY` regains health, holding again once a broken one is back to
 * `SHIELD_REARM`. Its bubble fades as it weakens.
 */
function recharge(shield: Shield, dt: number) {
	if (os.clock() - shield.hitAt < SHIELD_DELAY) return;
	shield.health = math.min(shield.health + SHIELD_REGEN * dt, shield.max);
	if (shield.broken && shield.health >= shield.max * SHIELD_REARM) shield.broken = false;
	shield.bubble.Transparency = shield.broken ? 1 : 0.6 * (1 - shield.health / shield.max);
}

/** Moves an alien up to its speed toward `goal`, across the ground, facing the way it goes. */
function walk(alien: Alien, goal: Vector3, dt: number) {
	const delta = new Vector3(goal.X - alien.x, 0, goal.Z - alien.z);
	if (delta.Magnitude <= 0.05) return;
	const step = delta.Unit.mul(math.min(alien.def.speed * dt, delta.Magnitude));
	alien.x += step.X;
	alien.z += step.Z;
	alien.facing = delta.Unit;
}

function flatDistance(a: Vector3, b: Vector3): number {
	return math.sqrt((a.X - b.X) ** 2 + (a.Z - b.Z) ** 2);
}

/** Whether a blast `splash` studs round `at` reaches a building: anywhere on its footprint, near enough. */
function reaches(building: Building, at: Vector3, splash: number): boolean {
	return flatDistance(building.position, at) <= splash + (BUILDINGS[building.kind].size * CELL_STUDS) / 2;
}

/** Every living character: where it is, and the humanoid to hurt. */
function livePlayers(): Array<[Vector3, Humanoid]> {
	const live = new Array<[Vector3, Humanoid]>();
	for (const player of Players.GetPlayers()) {
		const humanoid = player.Character?.FindFirstChildOfClass("Humanoid");
		const root = humanoid?.RootPart;
		if (humanoid && root && humanoid.Health > 0) live.push([root.Position, humanoid]);
	}
	return live;
}

/**
 * Runs the defend mission on the active planet: starts a fresh base for each
 * new map, launches the waves, lands the aliens in the drop zones (killing
 * anyone standing there), moves and fights them (walkers along a flowfield,
 * fliers straight for the Core), fires the turrets, and turns the result into a
 * conquest or a retreat. A liberated planet has no waves: the base just runs.
 * It also owns `BaseState`, which it sends to everyone as it changes.
 */
@Service()
export class WaveService implements OnStart {
	private readonly liberated = atom(false);
	private readonly wave = atom(0);
	private readonly waves = atom(0);
	private readonly nextWaveAt = atom(0);
	private readonly alienCount = atom(0);
	private readonly state = computed((): BaseState => {
		const pool = this.baseService.poolAtom();
		return {
			phase: this.baseService.phase(),
			planet: this.planetsService.activeAtom() ?? -1,
			liberated: this.liberated(),
			sandbox: this.baseService.sandbox(),
			wave: this.wave(),
			waves: this.waves(),
			nextWaveAt: this.nextWaveAt(),
			aliens: this.alienCount(),
			coreHealth: this.baseService.coreHealthAtom(),
			coreMaxHealth: this.baseService.coreMaxHealthAtom(),
			capacity: teamStat("coreCapacity"),
			pool: RESOURCE_ORDER.filter((resource) => pool[resource] !== undefined).map((resource) => ({
				resource,
				amount: pool[resource]!,
			})),
			dropZones: this.planetsService.currentMap()?.dropZones ?? [],
		};
	});

	private readonly aliens = new Map<Model, Alien>();
	private projectiles = new Array<Projectile>();
	/** Aliens waiting to spawn: in the drop zones, or `at` a spot of their own. */
	private pending = new Array<{ readonly kind: AlienKind; readonly at?: Vector3 }>();
	private healthScale = 1;
	private spawnIndex = 0;
	private costs?: { readonly map: PlanetMap; readonly costs: Array<number> };
	private field = new Array<number>(GRID_SIZE * GRID_SIZE, -1);
	private fieldRevision = -1;
	private fieldAt = 0;
	private spawnTimer = 0;
	private lastCall = -math.huge;
	private broadcastQueued = false;

	constructor(
		private readonly logger: Logger,
		private readonly baseService: BaseService,
		private readonly planetsService: PlanetsService,
		private readonly travelService: TravelService,
	) {}

	onStart() {
		baseMessaging.server.on(BaseMessage.Request, (player) => {
			baseMessaging.client.emit(player, BaseMessage.State, this.state());
			this.baseService.sendInventory(player);
		});
		baseMessaging.server.on(BaseMessage.CallWave, () => {
			if (os.clock() - this.lastCall < CALL_DEBOUNCE) return;
			this.lastCall = os.clock();
			this.launch();
		});

		subscribe(this.state, () => this.queueBroadcast());
		listen(this.planetsService.currentMap, (map) => this.begin(map));
		subscribe(this.baseService.resultAtom, (result) => {
			if (result !== undefined) this.finish(result);
		});
		RunService.Heartbeat.Connect((dt) => this.tick(dt));
	}

	/** Launches the next wave now. False when no mission is running or every wave is out. */
	launch(): boolean {
		const wave = this.wave() + 1;
		if (this.baseService.phase() !== "active" || wave > this.waves()) return false;
		this.wave(wave);
		this.nextWaveAt(wave < this.waves() ? Workspace.GetServerTimeNow() + WAVE_SECONDS : 0);
		for (const kind of composition(wave, wave === this.waves())) this.pending.push({ kind });
		this.logger.Info("Wave {Wave} of {Waves} launched", wave, this.waves());
		return true;
	}

	/** Sets how many waves have launched, so the next one is `wave + 1`. False when no mission is running. */
	setWave(wave: number): boolean {
		if (this.baseService.phase() !== "active") return false;
		const launched = math.clamp(wave, 0, this.waves());
		this.wave(launched);
		this.nextWaveAt(launched < this.waves() ? Workspace.GetServerTimeNow() + WAVE_SECONDS : 0);
		return true;
	}

	/** Queues aliens to spawn as if a wave sent them, or around `at` instead. False when no mission is running. */
	queue(kind: AlienKind, count: number, at?: Vector3): boolean {
		if (this.baseService.phase() !== "active") return false;
		for (let i = 0; i < count; i++) this.pending.push({ kind, at });
		return true;
	}

	/** Stops the waves, here and on every planet after (see `BaseService.sandbox`): aliens only come when called. */
	startSandbox() {
		this.liberated(true);
		this.wave(0);
		this.waves(0);
		this.nextWaveAt(0);
	}

	/** Kills every alien at once, and those waiting to spawn. */
	clearAliens() {
		for (const [model] of this.aliens) model.Destroy();
		this.aliens.clear();
		this.alienCount(0);
		this.projectiles = [];
		this.pending = [];
	}

	/**
	 * Hurts an alien, once any shield over it has soaked up what it can (see `absorb`); at zero it
	 * dies. Does nothing to a model that is not a live alien.
	 */
	damageAlien(model: Model, amount: number) {
		const alien = this.aliens.get(model);
		if (!alien) return;
		alien.health = math.max(alien.health - this.absorb(alien, amount), 0);
		setHealth(model, alien.health, alien.maxHealth);
		if (alien.health <= 0) this.remove(alien);
	}

	/** Takes an alien out at once, model and all. */
	private remove(alien: Alien) {
		alien.model.Destroy();
		this.aliens.delete(alien.model);
		this.alienCount(this.aliens.size());
	}

	/**
	 * Soaks up what it can of `amount` dealt to `alien` with the shield over it, and returns the rest.
	 * Like Mindustry's, shields that overlap join into one: every bubble linked to the one covering it,
	 * overlap by overlap, pools its health and takes its share, so they wear down and break together.
	 */
	private absorb(alien: Alien, amount: number): number {
		const up = new Array<Alien>();
		for (const [, other] of this.aliens) if (other.shield && !other.shield.broken) up.push(other);
		const radius = (other: Alien) => other.def.shield?.radius ?? 0;
		const apart = (a: Alien, b: Alien) => a.root.Position.sub(b.root.Position).Magnitude;
		const cover = up.find((other) => apart(other, alien) <= radius(other));
		if (!cover) return amount;

		const group = [cover];
		for (let i = 0; i < group.size(); i++) {
			for (const other of up) {
				if (!group.includes(other) && apart(group[i], other) <= radius(group[i]) + radius(other))
					group.push(other);
			}
		}
		let pooled = 0;
		for (const member of group) pooled += member.shield!.health;
		const soaked = math.min(amount, pooled);
		for (const member of group) {
			const shield = member.shield!;
			shield.health = math.max(shield.health - soaked * (shield.health / pooled), 0);
			shield.hitAt = os.clock();
			if (shield.health < 1) shield.broken = true;
			shield.bubble.Transparency = shield.broken ? 1 : 0.6 * (1 - shield.health / shield.max);
		}
		return amount - soaked;
	}

	/**
	 * A fresh start on `map` (or none): aliens gone and the base rebuilt. An occupied planet's
	 * waves start from the top after the grace period; a liberated one has none.
	 */
	private begin(map: PlanetMap | undefined) {
		this.clearAliens();
		this.baseService.reset(map);

		const liberated =
			map !== undefined && (this.baseService.sandbox() || this.planetsService.isConquered(map.planet));
		const planet = map && !liberated ? this.planetsService.getPlanet(map.planet) : undefined;
		this.liberated(liberated);
		this.healthScale = planet ? 1 + 0.3 * planet.difficulty + 0.2 * planet.aliens : 1;
		if (map && this.costs?.map !== map) this.costs = { map, costs: terrainCosts(map) };
		this.wave(0);
		this.waves(planet ? 5 + 2 * planet.difficulty : 0);
		this.nextWaveAt(planet ? Workspace.GetServerTimeNow() + GRACE_SECONDS : 0);
	}

	/** Shows the result for a while, then liberates the planet (the team stays on) or retreats the team. */
	private finish(result: "won" | "lost") {
		const map = this.planetsService.currentMap();
		this.nextWaveAt(0);
		task.delay(RESULT_SECONDS, () => {
			if (this.baseService.resultAtom() !== result || this.planetsService.currentMap() !== map) return;
			if (result === "won") {
				this.planetsService.conquer();
				this.liberated(true);
				this.baseService.resultAtom(undefined);
			} else {
				this.travelService.retreat();
			}
		});
	}

	private queueBroadcast() {
		if (this.broadcastQueued) return;
		this.broadcastQueued = true;
		task.delay(STATE_SECONDS, () => {
			this.broadcastQueued = false;
			baseMessaging.client.emitAll(BaseMessage.State, this.state());
		});
	}

	private tick(dt: number) {
		const map = this.planetsService.currentMap();
		if (!map || this.baseService.phase() !== "active") return;

		if (this.wave() < this.waves() && Workspace.GetServerTimeNow() >= this.nextWaveAt()) this.launch();
		this.spawnPending(map, dt);
		this.refreshField();
		this.moveAliens(map, dt);
		this.fireTurrets(map, dt);
		this.landProjectiles();

		if (!this.liberated() && this.wave() >= this.waves() && this.pending.isEmpty() && this.aliens.isEmpty()) {
			this.baseService.end("won");
		}
	}

	/** Spawns queued aliens one at a time, taking turns between the drop zones, while under the cap. */
	private spawnPending(map: PlanetMap, dt: number) {
		this.spawnTimer -= dt;
		if (this.spawnTimer > 0 || this.aliens.size() >= MAX_ALIENS || map.dropZones.isEmpty()) return;
		const queued = this.pending.shift();
		if (queued === undefined) return;
		const { kind } = queued;
		this.spawnTimer = SPAWN_SECONDS;

		const spawn = queued.at ?? map.dropZones[this.spawnIndex++ % map.dropZones.size()];
		if (queued.at === undefined) this.clearZone(spawn);
		const x = spawn.X + random.NextNumber(-SPAWN_SPREAD, SPAWN_SPREAD);
		const z = spawn.Z + random.NextNumber(-SPAWN_SPREAD, SPAWN_SPREAD);
		this.spawn(map, kind, x, z);
	}

	/** Brings a `kind` of alien in at (x, z): on the ground there, or flying its height over it. */
	private spawn(map: PlanetMap, kind: AlienKind, x: number, z: number) {
		const def = ALIENS[kind];
		const maxHealth = math.round(def.health * this.healthScale);
		const y = map.heightAt(x, z) + def.hover;
		const facing = new Vector3(0, 0, -1);
		// A CFrame looks along -Z: `facing`.
		const [model, root] = alienModel(
			kind,
			def.air ? new CFrame(x, y, z) : groundFrame(map, x, z, def.hover, facing),
		);
		model.SetAttribute("Kind", kind);
		setHealth(model, maxHealth, maxHealth);
		let shield: Shield | undefined;
		if (def.shield) {
			const max = math.round(def.shield.health * this.healthScale);
			shield = {
				health: max,
				broken: false,
				hitAt: 0,
				max,
				bubble: shieldBubble(model, root, def.shield.radius),
			};
		}
		model.Parent = this.baseService.aliensFolder;

		this.aliens.set(model, {
			model,
			root,
			def,
			maxHealth,
			health: maxHealth,
			x,
			z,
			offset: new Vector3(random.NextNumber(-2.5, 2.5), 0, random.NextNumber(-2.5, 2.5)),
			facing,
			y,
			pitch: 0,
			velocity: Vector3.zero,
			cooldown: 0,
			shield,
			cargo: def.cargo ?? 0,
		});
		this.alienCount(this.aliens.size());
	}

	/** Kills every player standing in the drop zone round `zone`: an alien is landing on them. */
	private clearZone(zone: Vector3) {
		for (const [position, humanoid] of livePlayers()) {
			if (flatDistance(position, zone) > DROP_ZONE_RADIUS) continue;
			humanoid.Health = 0;
			const player = Players.GetPlayerFromCharacter(humanoid.Parent);
			if (player) this.baseService.notify(player, "You were caught in a drop zone.");
		}
	}

	/** Rebuilds the flowfield after buildings change, at most every `FIELD_SECONDS`. */
	private refreshField() {
		const revision = this.baseService.revision;
		if (revision === this.fieldRevision || os.clock() - this.fieldAt < FIELD_SECONDS || !this.costs) return;
		this.fieldRevision = revision;
		this.fieldAt = os.clock();
		const targets = new Array<number>();
		// What blocks the way: everything but belts, which aliens walk over.
		const solid = new Map<number, Building>();
		for (const [cell, building] of this.baseService.cells) {
			if (building.kind === "core") targets.push(cell);
			if (!BUILDINGS[building.kind].walkable) solid.set(cell, building);
		}
		this.field = buildFlowfield(this.costs.costs, solid, targets);
	}

	private moveAliens(map: PlanetMap, dt: number) {
		const players = livePlayers();
		const parts = new Array<BasePart>();
		const cframes = new Array<CFrame>();

		// Where carriers drop crawlers, landed once every alien has moved: none join the map mid-loop.
		const drops = new Array<Vector3>();

		for (const [, alien] of this.aliens) {
			const { def } = alien;
			const reach = def.reach ?? 0;
			alien.cooldown -= dt;
			if (alien.shield) recharge(alien.shield, dt);
			const here = new Vector3(alien.x, alien.root.Position.Y, alien.z);
			const from = new Vector3(alien.x, alien.y, alien.z);
			// Something it is attacking: it stands still and faces it.
			let look: Vector3 | undefined;

			if (def.range !== undefined) {
				if (alien.cooldown <= 0) {
					alien.aim = this.shoot(alien, here, def.range, players);
					alien.cooldown = alien.aim ? def.rate : 0.25;
				}
				look = alien.aim;
			} else if (def.attack === "bomb") {
				if (alien.cooldown <= 0 && this.bomb(map, alien)) alien.cooldown = def.rate;
			} else if (def.attack === "drop") {
				if (alien.cooldown <= 0 && alien.cargo > 0) {
					alien.cooldown = def.rate;
					for (let i = 0; i < math.min(DROP_COUNT, alien.cargo); i++) drops.push(here);
					alien.cargo = math.max(alien.cargo - DROP_COUNT, 0);
				}
			} else if (alien.cooldown <= 0) {
				const victim = players.find(
					([position]) => flatDistance(position, here) <= reach + 1 && math.abs(position.Y - here.Y) < 8,
				);
				if (victim && def.attack === "explode") {
					this.explode(alien);
					continue;
				}
				if (victim) {
					victim[1].TakeDamage(def.damage);
					alien.cooldown = def.rate;
				}
			}

			if (!look && def.air) {
				// Straight for the Core, over walls and all.
				walk(alien, map.landing.add(alien.offset), dt);
			} else if (!look) {
				const cell = cellAt(alien.x, alien.z);
				const step = cell === undefined ? -1 : this.field[cell];
				const target = step >= 0 ? cellCenter(step) : map.landing;
				const onStep = step >= 0 ? this.baseService.cells.get(step) : undefined;
				const building = onStep && !BUILDINGS[onStep.kind].walkable ? onStep : undefined;
				if (building && flatDistance(target, here) <= CELL_STUDS / 2 + reach) {
					// Its path runs through a building: chew through it, or blow it up.
					look = target;
					if (alien.cooldown <= 0 && def.attack === "explode") {
						this.explode(alien);
						continue;
					}
					if (alien.cooldown <= 0) {
						this.baseService.damage(building, def.damage);
						alien.cooldown = def.rate;
					}
				} else {
					walk(alien, target.add(alien.offset), dt);
				}
			}

			const toward = look && new Vector3(look.X - alien.x, 0, look.Z - alien.z);
			if (toward && toward.Magnitude > 0.05) alien.facing = toward.Unit;
			if (def.air) fly(map, alien, from, dt);
			alien.velocity = new Vector3(alien.x, alien.y, alien.z).sub(from).div(dt);
			parts.push(alien.root);
			cframes.push(bodyFrame(map, alien));
		}

		Workspace.BulkMoveTo(parts, cframes, Enum.BulkMoveMode.FireCFrameChanged);
		for (const at of drops) {
			if (this.aliens.size() >= MAX_ALIENS) break;
			this.spawn(map, "crawler", at.X + random.NextNumber(-3, 3), at.Z + random.NextNumber(-3, 3));
		}
	}

	/** A sapper blows up where it stands, hurting everything round it, and is gone. */
	private explode(alien: Alien) {
		const at = alien.root.Position;
		const splash = alien.def.splash ?? 0;
		this.blastBase(at, splash, alien.def.damage);
		shotMessaging.client.emitAll(ShotMessage.Blast, { at, splash });
		this.remove(alien);
	}

	/** A bomber drops a bomb on the ground under it, if a building is there for it to hit. Returns whether it did. */
	private bomb(map: PlanetMap, alien: Alien): boolean {
		const ground = new Vector3(alien.x, map.heightAt(alien.x, alien.z), alien.z);
		for (const building of this.baseService.buildings) {
			if (!reaches(building, ground, alien.def.splash ?? 0)) continue;
			const from = alien.root.Position;
			// Straight down: the curve's bend is halfway.
			this.lob("shell", from, from.add(ground).div(2), ground, alien.def, BOMB_SECONDS);
			return true;
		}
		return false;
	}

	/**
	 * An alien's shell, bomb or rocket, from `from` onto `to` along a curve bending toward `control`,
	 * landing in `seconds` once clients have drawn it, and hurting the buildings and players round it.
	 */
	private lob(
		kind: "shell" | "rocket",
		from: Vector3,
		control: Vector3,
		to: Vector3,
		def: AlienDef,
		seconds: number,
	) {
		const splash = def.splash ?? 0;
		this.projectiles.push({ to, lands: os.clock() + seconds, damage: def.damage, splash, hostile: true });
		shotMessaging.client.emitAll(ShotMessage.Fired, { kind, from, control, to, seconds, splash });
	}

	/** Hurts every building and player within `splash` studs of `at`: an alien's explosion, shell or bomb. */
	private blastBase(at: Vector3, splash: number, damage: number) {
		for (const building of this.baseService.buildings) {
			if (reaches(building, at, splash)) this.baseService.damage(building, damage);
		}
		for (const [position, humanoid] of livePlayers()) {
			if (position.sub(at).Magnitude <= splash) humanoid.TakeDamage(damage);
		}
	}

	/**
	 * A ranged alien's attack on the nearest player or building in range (a gunship's on the nearest
	 * turret, if it has one in range): a shot that hits at once, or a mortar's shell or a gunship's
	 * rockets, which land later. Returns what it aimed at, if anything.
	 */
	private shoot(
		alien: Alien,
		here: Vector3,
		range: number,
		players: ReadonlyArray<[Vector3, Humanoid]>,
	): Vector3 | undefined {
		const { attack } = alien.def;
		let best = range;
		let aim: Vector3 | undefined;
		let humanoid: Humanoid | undefined;
		let building: Building | undefined;
		// ponytail: scans every building per shot; bucket buildings by cell if bases grow to thousands.
		if (attack === "rocket") {
			for (const candidate of this.baseService.buildings) {
				const distance = flatDistance(candidate.position, here);
				if (distance >= best || !BUILDINGS[candidate.kind].turret) continue;
				best = distance;
				aim = candidate.position;
			}
		}
		if (!aim) {
			for (const [position, candidate] of players) {
				const distance = flatDistance(position, here);
				if (distance >= best) continue;
				best = distance;
				aim = position;
				humanoid = candidate;
			}
			for (const candidate of this.baseService.buildings) {
				const distance = flatDistance(candidate.position, here);
				if (distance >= best) continue;
				best = distance;
				aim = candidate.position;
				humanoid = undefined;
				building = candidate;
			}
		}
		if (!aim) return undefined;

		const from = alien.root.Position;
		const distance = aim.sub(from).Magnitude;
		if (attack === "shell") {
			const control = from
				.add(aim)
				.div(2)
				.add(new Vector3(0, distance * 0.6, 0));
			this.lob("shell", from, control, aim, alien.def, LAUNCH_SECONDS + distance / SHELL_SPEED);
			return aim;
		}
		if (attack === "rocket") {
			// A pair, each veering off to its own side before curving down.
			for (const side of [-1, 1]) {
				const veer = new Vector3(side * random.NextNumber(0.1, 0.35) * distance, distance * 0.2, 0);
				const control = from.add(aim).div(2).add(veer);
				this.lob("rocket", from, control, aim, alien.def, LAUNCH_SECONDS + distance / ROCKET_SPEED);
			}
			return aim;
		}
		tracer(from, aim, ENEMY_TRACER);
		if (humanoid) humanoid.TakeDamage(alien.def.damage);
		else if (building) this.baseService.damage(building, alien.def.damage);
		return aim;
	}

	/**
	 * Every loaded turret that has cooled down shoots the nearest alien in range that it can hit (see
	 * `canHit`), and turns its head to face it. Damage scales with the ore it fires and its placer's
	 * research. Rockets, shells and flak land later.
	 */
	private fireTurrets(map: PlanetMap, dt: number) {
		for (const turret of this.baseService.buildings) {
			const def = BUILDINGS[turret.kind];
			const gun = def.turret;
			const head = turret.head;
			if (!gun || !head) continue;
			if (gun.spinUp !== undefined) {
				// Winds up while it has something to shoot, and down while it hasn't.
				const engaged = turret.engaged && !turret.ammo.isEmpty();
				turret.spin = math.clamp(turret.spin + (engaged ? dt / gun.spinUp : -dt / SPIN_DOWN_SECONDS), 0, 1);
			}
			if (turret.ammo.isEmpty()) continue;
			turret.cooldown -= dt;
			if (turret.cooldown > 0) continue;
			const from = head.Position;
			let best = def.range ?? 0;
			let target: Alien | undefined;
			for (const [, alien] of this.aliens) {
				const distance = flatDistance(alien.root.Position, from);
				if (distance >= best || !canHit(gun.targets, alien)) continue;
				best = distance;
				target = alien;
			}
			turret.engaged = target !== undefined;
			if (!target) continue;

			const at = target.root.Position;
			// Level at what's on the ground; tipped up at fliers.
			head.CFrame = CFrame.lookAt(from, target.def.air ? at : new Vector3(at.X, from.Y, at.Z));
			// Each shot from the next barrel round, and each shell of a volley from its own.
			const fired = turret.fired;
			const muzzle = (index: number) => {
				const tip = turret.muzzles[(fired + index) % math.max(turret.muzzles.size(), 1)];
				return tip ? head.CFrame.mul(tip) : head.CFrame;
			};
			// A burst's shots come in quick succession, then it reloads. One that spins up fires faster as it winds.
			turret.burst = (turret.burst + 1) % (gun.burst ?? 1);
			const rate = gun.spinUp !== undefined ? SPIN_SLOWEST + (1 - SPIN_SLOWEST) * turret.spin : 1;
			turret.cooldown = turret.burst === 0 ? gun.seconds / rate : BURST_SECONDS;
			const damage = gun.damage * (this.baseService.shoot(turret) ?? 0) * statOf(turret.owner, "turretDamage");
			if (gun.projectile) {
				for (let i = 0; i < (gun.volley ?? 1); i++) this.loose(map, muzzle(i), target, gun, damage);
			} else {
				// A slow gun's shot looks as heavy as the gun; a fast one's every shot can't blast.
				const size = gun.seconds >= 1 ? def.size : 1;
				shotMessaging.client.emitAll(ShotMessage.Hit, { from: muzzle(0).Position, to: at, size });
				this.damageAlien(target.model, damage);
			}
		}
	}

	/**
	 * Fires a rocket, shell or flak out of `muzzle` at `target`, which lands once clients have drawn
	 * its flight: a rocket shoots out the front, veering off to a random side before curving round
	 * into the target, chasing it; a shell arcs high and comes down anywhere within the turret's
	 * `spread` of where the target stood; flak flies straight and fast for where the target will be,
	 * bursting anywhere within `spread` of it.
	 */
	private loose(
		map: PlanetMap,
		muzzle: CFrame,
		target: Alien,
		gun: NonNullable<BuildingDef["turret"]>,
		damage: number,
	) {
		const from = muzzle.Position;
		const at = target.root.Position;
		const distance = at.sub(from).Magnitude;
		const rocket = gun.projectile === "rocket";
		let to = at;
		let control: Vector3;
		let seconds: number;
		if (rocket) {
			const ahead = muzzle.LookVector.mul(distance * 0.5);
			const veer = muzzle.RightVector.mul(random.NextNumber(-0.3, 0.3) * distance);
			control = from
				.add(ahead)
				.add(veer)
				.add(new Vector3(0, random.NextNumber(2, 8), 0));
			seconds = LAUNCH_SECONDS + distance / ROCKET_SPEED;
		} else if (gun.projectile === "flak") {
			// Leads the target by its speed, then strays: evenly through the ball, not bunched at its middle.
			const lead = at.add(target.velocity.mul(distance / FLAK_SPEED));
			to = lead.add(random.NextUnitVector().mul((gun.spread ?? 0) * random.NextNumber() ** (1 / 3)));
			control = from.add(to).div(2);
			seconds = to.sub(from).Magnitude / FLAK_SPEED;
		} else {
			// Evenly over the circle, not bunched at its middle.
			const angle = random.NextNumber(0, 2 * math.pi);
			const off = (gun.spread ?? 0) * math.sqrt(random.NextNumber());
			const x = at.X + math.cos(angle) * off;
			const z = at.Z + math.sin(angle) * off;
			to = new Vector3(x, map.heightAt(x, z), z);
			control = from
				.add(to)
				.div(2)
				.add(new Vector3(0, distance * 0.6, 0));
			seconds = LAUNCH_SECONDS + distance / SHELL_SPEED;
		}
		const splash = gun.splash ?? 0;
		this.projectiles.push({
			to,
			target: rocket ? target : undefined,
			lands: os.clock() + seconds,
			damage,
			splash,
			targets: gun.targets,
		});
		shotMessaging.client.emitAll(ShotMessage.Fired, {
			kind: gun.projectile ?? "shell",
			from,
			control,
			to,
			target: rocket ? target.model : undefined,
			seconds,
			splash,
		});
	}

	/**
	 * Lands the rockets, shells and bombs that are due, each hurting what's within its splash of where
	 * it comes down: the aliens a turret's can hit, or the buildings and players for an alien's.
	 */
	private landProjectiles() {
		const now = os.clock();
		this.projectiles = this.projectiles.filter((shot) => {
			if (shot.target && this.aliens.has(shot.target.model)) shot.to = shot.target.root.Position;
			if (now < shot.lands) return true;
			if (shot.hostile) this.blastBase(shot.to, shot.splash, shot.damage);
			else this.blastAliens(shot.to, shot.splash, shot.damage, shot.targets);
			return false;
		});
	}

	/**
	 * Hurts every alien within `splash` studs of `at` that a turret shooting `targets` can hit. In the
	 * air, not across the ground: a blast in the sky misses what's under it, and one on the ground what's over it.
	 */
	private blastAliens(at: Vector3, splash: number, damage: number, targets: "air" | "ground" | undefined) {
		for (const [model, alien] of this.aliens) {
			if (canHit(targets, alien) && alien.root.Position.sub(at).Magnitude <= splash)
				this.damageAlien(model, damage);
		}
	}
}
