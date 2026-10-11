import { OnStart, Service } from "@flamework/core";
import { atom, computed, listen, subscribe } from "@rbxts/charm";
import type { Logger } from "@rbxts/log";
import { Players, RunService, Workspace } from "@rbxts/services";
import { t } from "@rbxts/t";

import { BaseService, type Building } from "game/Base/server/BaseService";
import { buildFlowfield, terrainCosts } from "game/Base/server/flowfield";
import { alienModel, setHealth, tracer } from "game/Base/server/models";
import { BaseMessage, baseMessaging, type BaseState } from "game/Base/shared/base-network";
import { BUILDINGS } from "game/Base/shared/buildings";
import { RESOURCE_ORDER } from "game/Base/shared/resources";
import { PlanetsService } from "game/Planets/server/PlanetsService";
import { TravelService } from "game/Planets/server/TravelService";
import { statOf, teamStat } from "game/Research/server/research-store";
import type { PlanetMap } from "game/Terrain/server/planet-map";
import { CELL_STUDS, cellAt, cellCenter, GRID_SIZE } from "game/Terrain/shared/map";

export type AlienKind = "crawler" | "brute" | "spitter";
export const isAlienKind = t.literal("crawler", "brute", "spitter");

interface AlienDef {
	readonly health: number;
	/** Studs per second. */
	readonly speed: number;
	/** Per hit, to buildings and players alike. */
	readonly damage: number;
	/** Seconds between hits. */
	readonly rate: number;
	/** Melee reach past the edge of what it hits, in studs. */
	readonly reach: number;
	/** Height of the body's centre above the ground. */
	readonly hover: number;
	/** Ranged aliens stop this far out to shoot. */
	readonly range?: number;
}

const ALIENS: Record<AlienKind, AlienDef> = {
	crawler: { health: 30, speed: 14, damage: 6, rate: 0.8, reach: 4, hover: 1 },
	brute: { health: 240, speed: 6, damage: 40, rate: 1.6, reach: 6, hover: 2.2 },
	spitter: { health: 50, speed: 9, damage: 10, rate: 1.5, reach: 4, hover: 1.8, range: 36 },
};

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
	cooldown: number;
	/** Spitters: what they are shooting at. They stand still while they have it. */
	aim?: Vector3;
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
const TURRET_TRACER = Color3.fromRGB(255, 200, 90);
const SPIT_TRACER = Color3.fromRGB(80, 255, 160);

const random = new Random();

/** Which aliens wave `wave` (from 1) sends: a growing swarm, brutes from wave 3, spitters from wave 4. */
function composition(wave: number): Array<AlienKind> {
	const kinds = new Array<AlienKind>();
	for (let i = 0; i < 4 + 2 * wave; i++) kinds.push("crawler");
	for (let i = 0; i < math.floor((wave - 1) / 2); i++) kinds.push("brute");
	for (let i = 0; i < wave - 3; i++) kinds.push("spitter");
	return kinds;
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

function flatDistance(a: Vector3, b: Vector3): number {
	return math.sqrt((a.X - b.X) ** 2 + (a.Z - b.Z) ** 2);
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
 * new map, launches the waves, moves and fights the aliens along a flowfield,
 * fires the turrets, and turns the result into a conquest or a retreat. A
 * liberated planet has no waves: the base just runs. It also
 * owns `BaseState`, which it sends to everyone as it changes.
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
		};
	});

	private readonly aliens = new Map<Model, Alien>();
	private pending = new Array<AlienKind>();
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
		for (const kind of composition(wave)) this.pending.push(kind);
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

	/** Queues aliens to spawn as if a wave sent them. False when no mission is running. */
	queue(kind: AlienKind, count: number): boolean {
		if (this.baseService.phase() !== "active") return false;
		for (let i = 0; i < count; i++) this.pending.push(kind);
		return true;
	}

	/** Hurts an alien; at zero it dies. Does nothing to a model that is not a live alien. */
	damageAlien(model: Model, amount: number) {
		const alien = this.aliens.get(model);
		if (!alien) return;
		alien.health = math.max(alien.health - amount, 0);
		setHealth(model, alien.health, alien.maxHealth);
		if (alien.health > 0) return;
		model.Destroy();
		this.aliens.delete(model);
		this.alienCount(this.aliens.size());
	}

	/**
	 * A fresh start on `map` (or none): aliens gone and the base rebuilt. An occupied planet's
	 * waves start from the top after the grace period; a liberated one has none.
	 */
	private begin(map: PlanetMap | undefined) {
		for (const [model] of this.aliens) model.Destroy();
		this.aliens.clear();
		this.alienCount(0);
		this.pending = [];
		this.baseService.reset(map);

		const liberated = map !== undefined && this.planetsService.isConquered(map.planet);
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
		this.fireTurrets(dt);

		if (!this.liberated() && this.wave() >= this.waves() && this.pending.isEmpty() && this.aliens.isEmpty()) {
			this.baseService.end("won");
		}
	}

	/** Spawns queued aliens one at a time, round the spawn points, while under the cap. */
	private spawnPending(map: PlanetMap, dt: number) {
		this.spawnTimer -= dt;
		if (this.spawnTimer > 0 || this.aliens.size() >= MAX_ALIENS || map.alienSpawns.isEmpty()) return;
		const kind = this.pending.shift();
		if (kind === undefined) return;
		this.spawnTimer = SPAWN_SECONDS;

		const spawn = map.alienSpawns[this.spawnIndex++ % map.alienSpawns.size()];
		const x = spawn.X + random.NextNumber(-SPAWN_SPREAD, SPAWN_SPREAD);
		const z = spawn.Z + random.NextNumber(-SPAWN_SPREAD, SPAWN_SPREAD);
		const def = ALIENS[kind];
		const maxHealth = math.round(def.health * this.healthScale);
		const facing = new Vector3(0, 0, -1);
		const [model, root] = alienModel(kind, groundFrame(map, x, z, def.hover, facing));
		model.SetAttribute("Kind", kind);
		setHealth(model, maxHealth, maxHealth);
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
			cooldown: 0,
		});
		this.alienCount(this.aliens.size());
	}

	/** Rebuilds the flowfield after buildings change, at most every `FIELD_SECONDS`. */
	private refreshField() {
		const revision = this.baseService.revision;
		if (revision === this.fieldRevision || os.clock() - this.fieldAt < FIELD_SECONDS || !this.costs) return;
		this.fieldRevision = revision;
		this.fieldAt = os.clock();
		const targets = new Array<number>();
		for (const [cell, building] of this.baseService.cells) if (building.kind === "core") targets.push(cell);
		this.field = buildFlowfield(this.costs.costs, this.baseService.cells, targets);
	}

	private moveAliens(map: PlanetMap, dt: number) {
		const players = livePlayers();
		const parts = new Array<BasePart>();
		const cframes = new Array<CFrame>();

		for (const [, alien] of this.aliens) {
			const { def } = alien;
			alien.cooldown -= dt;
			const here = new Vector3(alien.x, alien.root.Position.Y, alien.z);
			// Something it is attacking: it stands still and faces it.
			let look: Vector3 | undefined;

			if (def.range !== undefined) {
				if (alien.cooldown <= 0) {
					alien.aim = this.spit(alien, here, def.range, players);
					alien.cooldown = alien.aim ? def.rate : 0.25;
				}
				look = alien.aim;
			} else if (alien.cooldown <= 0) {
				const victim = players.find(
					([position]) => flatDistance(position, here) <= def.reach + 1 && math.abs(position.Y - here.Y) < 8,
				);
				if (victim) {
					victim[1].TakeDamage(def.damage);
					alien.cooldown = def.rate;
				}
			}

			if (!look) {
				const cell = cellAt(alien.x, alien.z);
				const step = cell === undefined ? -1 : this.field[cell];
				const target = step >= 0 ? cellCenter(step) : map.landing;
				const building = step >= 0 ? this.baseService.cells.get(step) : undefined;
				if (building && flatDistance(target, here) <= CELL_STUDS / 2 + def.reach) {
					// Its path runs through a building: chew through it.
					look = target;
					if (alien.cooldown <= 0) {
						this.baseService.damage(building, def.damage);
						alien.cooldown = def.rate;
					}
				} else {
					const goal = target.add(alien.offset);
					const delta = new Vector3(goal.X - alien.x, 0, goal.Z - alien.z);
					if (delta.Magnitude > 0.05) {
						const step = delta.Unit.mul(math.min(def.speed * dt, delta.Magnitude));
						alien.x += step.X;
						alien.z += step.Z;
						alien.facing = delta.Unit;
					}
				}
			}

			const toward = look && new Vector3(look.X - alien.x, 0, look.Z - alien.z);
			if (toward && toward.Magnitude > 0.05) alien.facing = toward.Unit;
			parts.push(alien.root);
			cframes.push(groundFrame(map, alien.x, alien.z, def.hover, alien.facing));
		}

		Workspace.BulkMoveTo(parts, cframes, Enum.BulkMoveMode.FireCFrameChanged);
	}

	/** A spitter's shot at the nearest player or building in range. Returns what it shot at, if anything. */
	private spit(
		alien: Alien,
		here: Vector3,
		range: number,
		players: ReadonlyArray<[Vector3, Humanoid]>,
	): Vector3 | undefined {
		let best = range;
		let aim: Vector3 | undefined;
		let humanoid: Humanoid | undefined;
		let building: Building | undefined;
		for (const [position, candidate] of players) {
			const distance = flatDistance(position, here);
			if (distance >= best) continue;
			best = distance;
			aim = position;
			humanoid = candidate;
		}
		// ponytail: scans every building per shot; bucket buildings by cell if bases grow to thousands.
		for (const candidate of this.baseService.buildings) {
			const distance = flatDistance(candidate.position, here);
			if (distance >= best) continue;
			best = distance;
			aim = candidate.position;
			humanoid = undefined;
			building = candidate;
		}
		if (!aim) return undefined;

		tracer(alien.root.Position, aim, SPIT_TRACER);
		if (humanoid) humanoid.TakeDamage(alien.def.damage);
		else if (building) this.baseService.damage(building, alien.def.damage);
		return aim;
	}

	/**
	 * Every turret that has cooled down shoots the nearest alien in range, and turns its head to face it.
	 * Damage scales with its placer's research.
	 */
	private fireTurrets(dt: number) {
		for (const turret of this.baseService.buildings) {
			const def = BUILDINGS[turret.kind];
			const head = turret.head;
			if (!def.turret || !head) continue;
			turret.cooldown -= dt;
			if (turret.cooldown > 0) continue;
			const from = head.Position;
			let best = def.range ?? 0;
			let target: Alien | undefined;
			for (const [, alien] of this.aliens) {
				const distance = flatDistance(alien.root.Position, from);
				if (distance >= best) continue;
				best = distance;
				target = alien;
			}
			if (!target) continue;

			const at = target.root.Position;
			head.CFrame = CFrame.lookAt(from, new Vector3(at.X, from.Y, at.Z));
			tracer(from, at, TURRET_TRACER);
			turret.cooldown = def.turret.seconds;
			this.damageAlien(target.model, def.turret.damage * statOf(turret.owner, "turretDamage"));
		}
	}
}
