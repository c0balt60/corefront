import { OnStart, Service } from "@flamework/core";
import { atom, computed, listen, subscribe } from "@rbxts/charm";
import type { Logger } from "@rbxts/log";
import { Debris, Players, RunService, Workspace } from "@rbxts/services";

import { BaseService, type Building } from "game/Base/server/BaseService";
import { buildFlowfield, terrainCosts } from "game/Base/server/flowfield";
import { alienModel, alienTurrets, setHealth, setTarget, shieldBubble } from "game/Base/server/models";
import { ALIEN_GAITS } from "game/Base/shared/alien-legs";
import {
	ALIEN_KINDS,
	type AlienKind,
	BaseMessage,
	baseMessaging,
	type BaseState,
	bezier,
	type Shot,
	ShotMessage,
	shotMessaging,
} from "game/Base/shared/base-network";
import {
	aimFrame,
	BUILDINGS,
	BEAM_PULSE,
	BEAM_TURN,
	DROP_ZONE_RADIUS,
	type EnergyDef,
	shotSpeed,
	turnHead,
	turretAim,
	type TurretDef,
} from "game/Base/shared/buildings";
import { RESOURCE_ORDER } from "game/Base/shared/resources";
import { PlanetsService } from "game/Planets/server/PlanetsService";
import { TravelService } from "game/Planets/server/TravelService";
import { statOf, teamStat } from "game/Research/server/research-store";
import type { PlanetMap } from "game/Terrain/server/planet-map";
import { TerrainService } from "game/Terrain/server/TerrainService";
import { CELL_STUDS, cellAt, cellCenter, GRID_SIZE } from "game/Terrain/shared/map";

export const isAlienKind = (value: unknown): value is AlienKind => ALIEN_KINDS.includes(value as AlienKind);

/**
 * What an alien does with its own body, besides chewing through the buildings in its way (every
 * walker does that, with its `damage` every `rate` seconds):
 * - `melee`: hits the players it reaches.
 * - `explode`: like melee, but its first hit blows it up, hurting everything within `splash`.
 * - `bomb`: never stops; drops a bomb whenever a building is under it, blasting `splash` round.
 * - `drop`: never stops; drops crawlers from its `cargo` every `rate` seconds until it's empty.
 * Without one it only fights with its guns.
 */
type Attack = "melee" | "explode" | "bomb" | "drop";

/**
 * One of an alien's guns, each picking its own target and firing on its own clock: every `rate`
 * seconds while it has something within `range` (and its `arc`), the nearest building it can find,
 * or with none in reach the nearest player. It fires on the move: aliens never stop to shoot.
 * - `shoot`: a shot that hits at once.
 * - `shell`: a shell lobbed high, blasting `splash` round where it lands.
 * - `rocket`: a `salvo` of rockets (two if not said), each veering off to a side before curving
 *   down, blasting `splash` round.
 * - `intercept`: point defence. Shoots the nearest turret rocket or shell in the air out of it.
 */
interface Gun {
	readonly kind: "shoot" | "shell" | "rocket" | "intercept";
	readonly damage: number;
	readonly rate: number;
	readonly range: number;
	readonly splash?: number;
	readonly salvo?: number;
	/**
	 * The turret on the model it's mounted in, which turns to aim it (see `alienTurrets`), and how far
	 * either way it turns off where it rests, in degrees (all the way round if not said). Without a
	 * turret it's fixed in the hull and fires from its middle: rocket racks, whose rockets curve round.
	 */
	readonly turret?: number;
	readonly arc?: number;
	/** Picks the nearest turret when it has one in reach, before any other building. */
	readonly prefers?: "turrets";
	/** How heavy its shots look (see `ShotMessage.Hit`): 2 and up also blast. */
	readonly size?: number;
}

interface AlienDef {
	readonly health: number;
	/** Studs per second. */
	readonly speed: number;
	/** Per hit of its own `attack` and its chewing, to buildings and players alike. */
	readonly damage: number;
	/** Seconds between those hits. */
	readonly rate: number;
	readonly attack?: Attack;
	readonly guns?: ReadonlyArray<Gun>;
	/** Melee reach past the edge of what it hits, in studs. */
	readonly reach?: number;
	/** Height of the body's centre above the ground. */
	readonly hover: number;
	/** Studs round where its explosion or bomb goes off that it hurts. */
	readonly splash?: number;
	/** Flies straight for the Core over everything, and only turrets that shoot fliers can hit it. */
	readonly air?: true;
	/** The most it turns, in radians a second (`TURN_RATE` if not said): big machines come round slowly. */
	readonly turn?: number;
	/**
	 * Fliers that fly like aircraft: always under way, in sweeping passes over the base instead of
	 * hovering over the Core (see `steer`).
	 */
	readonly aircraft?: true;
	/** Shielders: their bubble's radius, in studs, and the damage it soaks before it breaks (see `absorb`). */
	readonly shield?: { readonly radius: number; readonly health: number };
	/** Carriers: the crawlers aboard. */
	readonly cargo?: number;
}

/** A frigate's or dreadnought's broadside: the same gun on each of its four side turrets, `first` on. */
function broadside(first: number, gun: Omit<Gun, "turret">): Array<Gun> {
	return [first, first + 1, first + 2, first + 3].map((turret) => ({ ...gun, turret }));
}

/*
 * Ranges against the turrets': the Scorch's 28, the Fuse's 36, the Turret's 56, the Auto-Turret's 60,
 * the Vulcan's 72, the Salvo's 76, the Scatter's and the Swarmer's 80, the Hail's and the Cannon's
 * 100, the Reaper's 104, the Ripple's 220 and the Harbinger's 320. Some ammo reaches further.
 */
const ALIENS: Record<AlienKind, AlienDef> = {
	crawler: { health: 30, speed: 14, damage: 6, rate: 0.8, attack: "melee", reach: 4, hover: 1.5 },
	sapper: { health: 40, speed: 16, damage: 70, rate: 0, attack: "explode", reach: 3, hover: 1.2, splash: 10 },
	brute: {
		health: 240,
		speed: 6,
		damage: 40,
		rate: 1.6,
		attack: "melee",
		reach: 6,
		hover: 1.9,
		turn: 1.5,
		guns: [{ kind: "shoot", damage: 8, rate: 0.8, range: 36, turret: 0 }],
	},
	spitter: {
		health: 50,
		speed: 9,
		damage: 10,
		rate: 1.5,
		reach: 4,
		hover: 2.8,
		guns: [{ kind: "shoot", damage: 10, rate: 1.5, range: 36, turret: 0, arc: 60 }],
	},
	// Outranges the Turret and Auto-Turret.
	mortar: {
		health: 200,
		speed: 5,
		damage: 35,
		rate: 4,
		reach: 6,
		hover: 2.5,
		turn: 1.6,
		guns: [{ kind: "shell", damage: 35, rate: 4, range: 72, splash: 8, turret: 0 }],
	},
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
	strider: {
		health: 320,
		speed: 8,
		damage: 12,
		rate: 1,
		reach: 4,
		hover: 3.2,
		turn: 2.5,
		guns: [{ kind: "shoot", damage: 7, rate: 0.5, range: 44, turret: 0 }],
	},
	// Point defence for the units round it. Each rocket or shell it shoots down is one that never lands.
	aegis: {
		health: 300,
		speed: 7,
		damage: 6,
		rate: 1,
		reach: 4,
		hover: 2.4,
		guns: [{ kind: "intercept", damage: 0, rate: 0.4, range: 30, turret: 0 }],
	},
	hydra: {
		health: 900,
		speed: 5,
		damage: 30,
		rate: 1.5,
		reach: 6,
		hover: 3.4,
		turn: 1.6,
		guns: [
			{ kind: "shoot", damage: 5, rate: 0.2, range: 36, turret: 0 },
			{ kind: "shell", damage: 30, rate: 3.5, range: 64, splash: 6, turret: 1 },
			{ kind: "rocket", damage: 16, rate: 4, range: 56, splash: 5, turret: 2, prefers: "turrets" },
		],
	},
	// Its cannon outranges everything but the artillery, the Cannon, Reaper and Harbinger; its flank guns cover its sides.
	fortress: {
		health: 1600,
		speed: 3,
		damage: 80,
		rate: 2,
		attack: "melee",
		reach: 7,
		hover: 6.4,
		turn: 1.2,
		guns: [
			{ kind: "shell", damage: 60, rate: 5, range: 84, splash: 10, turret: 0 },
			{ kind: "shoot", damage: 6, rate: 0.2, range: 36, turret: 1, arc: 120 },
			{ kind: "shoot", damage: 6, rate: 0.2, range: 36, turret: 2, arc: 120 },
		],
	},
	titan: {
		health: 2500,
		speed: 3.5,
		damage: 150,
		rate: 2,
		attack: "melee",
		reach: 9,
		hover: 8.8,
		turn: 0.9,
		guns: [
			{ kind: "shoot", damage: 30, rate: 1.6, range: 48, turret: 0, arc: 70, size: 2 },
			{ kind: "shoot", damage: 30, rate: 1.6, range: 48, turret: 1, arc: 70, size: 2 },
			{ kind: "rocket", damage: 20, rate: 4, range: 64, splash: 6, turret: 2, prefers: "turrets" },
		],
	},
	drone: {
		health: 35,
		speed: 18,
		damage: 0,
		rate: 0,
		hover: 16,
		air: true,
		turn: 3,
		guns: [{ kind: "shoot", damage: 5, rate: 0.6, range: 30, turret: 0 }],
	},
	wasp: {
		health: 80,
		speed: 24,
		damage: 0,
		rate: 0,
		hover: 14,
		air: true,
		turn: 1.6,
		aircraft: true,
		guns: [{ kind: "shoot", damage: 4, rate: 0.25, range: 32, turret: 0 }],
	},
	hornet: {
		health: 160,
		speed: 13,
		damage: 0,
		rate: 0,
		hover: 18,
		turn: 2.5,
		air: true,
		guns: [
			{ kind: "shoot", damage: 5, rate: 0.4, range: 32, turret: 0 },
			{ kind: "rocket", damage: 12, rate: 3.5, range: 48, splash: 4, salvo: 4 },
		],
	},
	bomber: { health: 260, speed: 8, damage: 30, rate: 1.2, attack: "bomb", hover: 22, splash: 9, air: true, turn: 1 },
	// Its rockets outrange the Turret and Auto-Turret, not the Scatter or Vulcan.
	gunship: {
		health: 700,
		speed: 7,
		damage: 0,
		rate: 0,
		hover: 26,
		turn: 1.2,
		air: true,
		guns: [
			{ kind: "rocket", damage: 30, rate: 3, range: 64, splash: 6, prefers: "turrets" },
			{ kind: "shoot", damage: 6, rate: 0.35, range: 40, turret: 0 },
		],
	},
	carrier: { health: 600, speed: 6, damage: 0, rate: 5, attack: "drop", hover: 24, cargo: 8, air: true, turn: 0.8 },
	frigate: {
		health: 1400,
		speed: 5,
		damage: 0,
		rate: 0,
		hover: 28,
		air: true,
		turn: 0.35,
		aircraft: true,
		guns: broadside(0, { kind: "shoot", damage: 8, rate: 0.45, range: 44, arc: 100 }),
	},
	dreadnought: {
		health: 4500,
		speed: 3,
		damage: 0,
		rate: 0,
		hover: 34,
		air: true,
		turn: 0.2,
		aircraft: true,
		guns: [
			{ kind: "shell", damage: 80, rate: 6, range: 90, splash: 12, turret: 0 },
			...broadside(1, { kind: "shoot", damage: 7, rate: 0.3, range: 44, arc: 110 }),
			{ kind: "rocket", damage: 16, rate: 5, range: 64, splash: 6, salvo: 6, prefers: "turrets" },
		],
	},
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

/** One of an alien's guns as it fights: its clock, and what it's aiming at, if anything. */
interface Weapon {
	readonly gun: Gun;
	cooldown: number;
	at?: Vector3;
}

interface Alien {
	readonly model: Model;
	readonly root: BasePart;
	readonly def: AlienDef;
	readonly maxHealth: number;
	health: number;
	x: number;
	z: number;
	/** A fixed nudge off each cell centre, so a swarm doesn't walk in single file. */
	readonly offset: Vector3;
	/** How far round it other aliens keep off (see `separate`). */
	readonly radius: number;
	facing: Vector3;
	/** Fliers: their height, which climbs ahead of rising ground, and how far they're tipped nose up, in radians. */
	y: number;
	pitch: number;
	/** Aircraft (see `steer`): how far they're banked into a turn, in radians, and where their pass is headed. */
	roll: number;
	goal?: Vector3;
	/** Studs per second, as it last moved: where flak leads it. */
	velocity: Vector3;
	cooldown: number;
	/** Its guns (see `trigger`). */
	readonly weapons: ReadonlyArray<Weapon>;
	/** Where its turrets pivot on its hull, and how far out of each its gun fires (see `alienTurrets`). */
	readonly mounts: ReadonlyArray<readonly [pivot: CFrame, barrel: number]>;
	readonly shield?: Shield;
	/** Carriers: the crawlers still aboard. */
	cargo: number;
}

/**
 * A turret's bullet, flame, rocket, shell or flak, or an alien's shell, bomb or rocket, in the air
 * (see `Shot`): fired at `fired` and landing at `lands`, `os.clock()` times.
 */
interface Projectile {
	readonly id: number;
	readonly kind: Shot["kind"];
	readonly from: Vector3;
	readonly control: Vector3;
	/** Where it lands: its target's position, while that lives. */
	to: Vector3;
	readonly target?: Alien;
	readonly fired: number;
	readonly lands: number;
	readonly damage: number;
	readonly splash: number;
	/** A turret's: the aliens it can hit (see `canHit`). */
	readonly targets?: "air" | "ground";
	/** A piercing bullet's: how many aliens along its flight it hits after the first (see `pierceAliens`). */
	readonly pierce?: number;
	/** Bullets' and flames': how heavy they look (see `Shot`). */
	readonly size?: number;
	/** A turret's: which turret, and which of its barrels (see `Shot`). */
	readonly turret?: Model;
	readonly barrel?: number;
	/** An alien's: it hurts buildings and players instead. */
	readonly hostile?: true;
}

/** Something an alien's gun can shoot: a player or a building, and where it is. */
interface Mark {
	readonly at: Vector3;
	readonly humanoid?: Humanoid;
	readonly building?: Building;
}

/** Seconds to build before a planet's first wave, and between a wave being cleared and the next. */
const GRACE_SECONDS = 180;
const WAVE_SECONDS = 45;
/** Waves on a planet: this many, plus `WAVES_PER_DIFFICULTY` for each level of its difficulty. */
const BASE_WAVES = 8;
const WAVES_PER_DIFFICULTY = 3;
/**
 * The furthest `composition` stage a planet's waves reach, by its difficulty (0 to 4): what kinds of
 * alien it sends at all. Its waves climb from stage 1 to this one evenly.
 */
const MAX_STAGES = [3, 6, 8, 10, 13];
/** Extra health a planet's last wave has over its first, as a share: the waves in between climb evenly. */
const HEALTH_RAMP = 0.6;
/** How long a dead alien's wreck lasts before it's gone: long enough for clients to drop and sink it (see `DamageController`). */
const WRECK_SECONDS = 8;
const CALL_DEBOUNCE = 2;
const MAX_ALIENS = 80;
const SPAWN_SECONDS = 0.1;
const SPAWN_SPREAD = 6;
const RESULT_SECONDS = 8;
const FIELD_SECONDS = 0.5;
const STATE_SECONDS = 0.2;
/** Seconds a gun with nothing to shoot waits before it looks again. */
const RETARGET_SECONDS = 0.25;
/** How far a turret's aim must move before clients hear of it, in studs. */
const AIM_SLACK = 0.5;
/** How near on target, as the cosine of the angle off, a turret's guns must be before it fires (see `fireTurrets`). */
const FIRE_CONE = math.cos(math.rad(15));
/** How far off an alien's middle, past its `radius`, a bullet still hits it. */
const BULLET_SLACK = 1;
/** How fast rockets and shells fly, in studs per second, after a moment to clear the turret. */
const ROCKET_SPEED = 90;
const SHELL_SPEED = 110;
const LAUNCH_SECONDS = 0.3;
/** Seconds a bomber's bomb takes to fall. */
const BOMB_SECONDS = 0.6;
/** How far lightning leaps from one alien to the next, in studs (see `AmmoDef.chain`). */
const ARC_JUMP = 18;
/** A beam laser lights only with its target within this cone (cosine of 40°), and reaches out and draws back in over this many seconds. */
const BEAM_CONE = math.cos(math.rad(40));
const BEAM_FADE = 0.27;
/** Seconds between the shots of a turret's burst, unless it says (see `TurretDef.gap`). */
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
/** The furthest an aircraft banks, in a turn as tight as it can make, and the rate per second it eases into it. */
const MAX_BANK = math.rad(40);
const BANK_RATE = 3;
/** How far round the Core an aircraft's passes cross. */
const PASS_RADIUS = 36;
/**
 * The most an alien turns in a second, in radians, unless it says (see `AlienDef.turn`), and the
 * share of its speed it keeps while turning to go back the way it came.
 */
const TURN_RATE = 4;
const SLOWEST_SHARE = 0.15;
/** Nearer its goal than this, an alien slides the rest of the way: it's inside the circle it turns in. */
const ARRIVE_STUDS = 3;
/** Cells down the flowfield a walker steers for, so it cuts the path's corners instead of turning at each cell. */
const LOOKAHEAD = 2;
/**
 * Shield regained per second once it's gone this many seconds without a hit, and the share of its
 * max a broken shield needs back before it holds again.
 */
const SHIELD_REGEN = 40;
const SHIELD_DELAY = 2;
const SHIELD_REARM = 0.5;
/** Crawlers a carrier drops at a time. */
const DROP_COUNT = 2;
/**
 * The fastest overlapping aliens are pushed apart, in studs a second: ones that land on top of each
 * other slide apart rather than jump, yet a crowd walking into those ahead can't squeeze in. And how
 * far out to a walker's feet others keep off.
 */
const SHOVE_SPEED = 60;
const LEG_SHARE = 0.8;
/** Seconds between one player's pings. */
const PING_DEBOUNCE = 0.25;

const random = new Random();

/** The `composition` stage wave `wave` (from 1) of `waves` reaches on a planet whose waves top out at `maxStage`. */
function stageOf(wave: number, waves: number, maxStage: number): number {
	return 1 + math.floor(((wave - 1) * (maxStage - 1)) / math.max(waves - 1, 1));
}

/**
 * Which aliens wave `wave` (from 1) sends at `stage` (see `stageOf`): a swarm growing with each wave,
 * and by stage, sappers from 2, brutes, drones and striders from 3, spitters, shielders and wasps
 * from 4, aegises and hornets from 5, mortars from 6, bombers and hydras from 7, gunships and
 * fortresses from 8, and carriers and frigates from 9. The `final` wave brings a Titan from stage 6
 * and a Dreadnought from stage 8.
 */
function composition(wave: number, stage: number, final: boolean): Array<AlienKind> {
	const kinds = new Array<AlienKind>();
	const add = (kind: AlienKind, count: number) => {
		for (let i = 0; i < count; i++) kinds.push(kind);
	};
	add("crawler", 4 + wave + stage);
	add("sapper", math.floor(stage / 2));
	add("brute", math.floor((stage - 1) / 2));
	add("drone", stage - 2);
	add("strider", math.floor((stage - 1) / 2));
	add("spitter", stage - 3);
	add("shielder", math.floor((stage - 2) / 2));
	add("wasp", math.floor((stage - 2) / 2));
	add("aegis", math.floor((stage - 3) / 2));
	add("hornet", math.floor((stage - 3) / 2));
	add("mortar", math.floor((stage - 4) / 2));
	add("bomber", math.floor((stage - 5) / 2));
	add("hydra", math.floor((stage - 5) / 2));
	add("gunship", math.floor((stage - 6) / 2));
	add("fortress", math.floor((stage - 6) / 2));
	add("carrier", math.floor((stage - 7) / 2));
	add("frigate", math.floor((stage - 7) / 2));
	add("titan", final && stage >= 6 ? 1 : 0);
	add("dreadnought", final && stage >= 8 ? 1 : 0);
	return kinds;
}

/** How far round an alien others keep off: the longer half of its hull, or most of the way out to its feet. */
function footprint(kind: AlienKind, hull: Vector3): number {
	let radius = math.max(hull.X, hull.Z) / 2;
	const gait = ALIEN_GAITS[kind];
	if (!gait) return radius;
	const pad = (gait.pad?.X ?? 0) / 2;
	for (const { rest } of gait.legs)
		radius = math.max(radius, LEG_SHARE * (math.sqrt(rest.X ** 2 + rest.Z ** 2) + pad));
	return radius;
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

/** Where an alien's body goes: on the ground (see `groundFrame`), or for a flier at its height, tipped by its pitch and banked by its roll. */
function bodyFrame(map: PlanetMap, alien: Alien): CFrame {
	if (!alien.def.air) return groundFrame(map, alien.x, alien.z, alien.def.hover, alien.facing);
	const position = new Vector3(alien.x, alien.y, alien.z);
	return CFrame.lookAt(position, position.add(alien.facing)).mul(CFrame.Angles(alien.pitch, 0, alien.roll));
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

/** Turns an alien's facing toward `want` (level), at most its `turn` a second. Returns how far it turned, in radians: positive is left. */
function turnToward(alien: Alien, want: Vector3, dt: number): number {
	const { facing } = alien;
	// Signed, about +Y.
	const wanted = math.atan2(facing.Z * want.X - facing.X * want.Z, facing.Dot(want));
	const most = (alien.def.turn ?? TURN_RATE) * dt;
	const angle = math.clamp(wanted, -most, most);
	alien.facing = CFrame.Angles(0, angle, 0).mul(facing).Unit;
	return angle;
}

/**
 * Moves an alien toward `goal` across the ground the way it faces, turning toward it as it goes (see
 * `turnToward`). It slows while the goal is off to its side, down to `SLOWEST_SHARE` of its speed
 * with it behind, so it comes round on the spot rather than swinging wide. Within `ARRIVE_STUDS` it
 * slides straight on and stops there, still facing the way it came: turning, it would circle round it.
 */
function walk(alien: Alien, goal: Vector3, dt: number) {
	const delta = new Vector3(goal.X - alien.x, 0, goal.Z - alien.z);
	const distance = delta.Magnitude;
	if (distance < 1e-3) return;
	if (distance <= ARRIVE_STUDS) {
		const slide = delta.Unit.mul(math.min(alien.def.speed * dt, distance));
		alien.x += slide.X;
		alien.z += slide.Z;
		return;
	}
	turnToward(alien, delta, dt);
	const step = alien.def.speed * math.max(alien.facing.Dot(delta.Unit), SLOWEST_SHARE) * dt;
	alien.x += alien.facing.X * step;
	alien.z += alien.facing.Z * step;
}

/**
 * Flies an aircraft on at full speed, turning toward its goal at most its `turn` a second, so it
 * sweeps past and has to come round again, banking into the turn. Once it's flown past (the goal is
 * behind it, nearer than a full turn takes), it picks another over the base.
 */
function steer(map: PlanetMap, alien: Alien, dt: number) {
	const { speed, turn = TURN_RATE } = alien.def;
	let toward = alien.goal && new Vector3(alien.goal.X - alien.x, 0, alien.goal.Z - alien.z);
	if (!toward || (toward.Dot(alien.facing) < 0 && toward.Magnitude < (2 * speed) / turn)) {
		const angle = random.NextNumber(0, 2 * math.pi);
		const off = PASS_RADIUS * math.sqrt(random.NextNumber());
		alien.goal = map.landing.add(new Vector3(math.cos(angle) * off, 0, math.sin(angle) * off));
		toward = new Vector3(alien.goal.X - alien.x, 0, alien.goal.Z - alien.z);
	}
	const angle = turnToward(alien, toward, dt);
	alien.x += alien.facing.X * speed * dt;
	alien.z += alien.facing.Z * speed * dt;
	// Its outer wing up, as far as the turn is tight.
	const most = turn * dt;
	const bank = most > 0 ? (angle / most) * MAX_BANK : 0;
	alien.roll += (bank - alien.roll) * math.min(dt * BANK_RATE, 1);
}

/** Whether `point` is within `arc` degrees either way of where a turret resting at `mount` looks. Without an arc, it turns all the way round. */
function inArc(mount: CFrame, point: Vector3, arc: number | undefined): boolean {
	if (arc === undefined) return true;
	const offset = mount.PointToObjectSpace(point);
	return math.abs(math.deg(math.atan2(-offset.X, -offset.Z))) <= arc;
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
 * fliers straight for the Core, aircraft in passes over it, every gun on its
 * own, none standing in another), fires the turrets, and turns the result into a conquest or a retreat. A liberated planet has no waves: the base just runs.
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
			generated: this.terrainService.progressAtom(),
		};
	});

	private readonly aliens = new Map<Model, Alien>();
	private projectiles = new Array<Projectile>();
	private shotId = 0;
	/** Aliens waiting to spawn: in the drop zones, or `at` a spot of their own. */
	private pending = new Array<{ readonly kind: AlienKind; readonly at?: Vector3 }>();
	private healthScale = 1;
	private maxStage = 1;
	private spawnIndex = 0;
	private costs?: { readonly map: PlanetMap; readonly costs: Array<number> };
	private field = new Array<number>(GRID_SIZE * GRID_SIZE, -1);
	private fieldRevision = -1;
	private fieldAt = 0;
	private fieldBuilding = false;
	private spawnTimer = 0;
	private lastCall = -math.huge;
	private readonly lastPing = new Map<Player, number>();
	private broadcastQueued = false;

	constructor(
		private readonly logger: Logger,
		private readonly baseService: BaseService,
		private readonly planetsService: PlanetsService,
		private readonly travelService: TravelService,
		private readonly terrainService: TerrainService,
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
		baseMessaging.server.on(BaseMessage.Ping, (player) => this.ping(player));
		Players.PlayerRemoving.Connect((player) => this.lastPing.delete(player));

		subscribe(this.state, () => this.queueBroadcast());
		listen(this.planetsService.currentMap, (map) => this.begin(map));
		subscribe(this.baseService.resultAtom, (result) => {
			if (result !== undefined) this.finish(result);
		});
		RunService.Heartbeat.Connect((dt) => this.tick(dt));
	}

	/** A player pinged: everyone sees every alien for a while (see `PingController`). */
	private ping(player: Player) {
		const now = os.clock();
		if (now - (this.lastPing.get(player) ?? -math.huge) < PING_DEBOUNCE) return;
		this.lastPing.set(player, now);
		baseMessaging.client.emitAll(BaseMessage.Pinged);
	}

	/** Launches the next wave now. False when no mission is running or every wave is out. Its countdown stops till it's cleared. */
	launch(): boolean {
		const wave = this.wave() + 1;
		const waves = this.waves();
		if (this.baseService.phase() !== "active" || wave > waves) return false;
		this.wave(wave);
		this.nextWaveAt(0);
		const stage = stageOf(wave, waves, this.maxStage);
		for (const kind of composition(wave, stage, wave === waves)) this.pending.push({ kind });
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
		this.baseService.wrecksFolder.ClearAllChildren();
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
		if (alien.health <= 0) this.kill(alien);
	}

	/** Takes a dead alien out of the fight, with a blast, and leaves its wreck to clients to sink (see `DamageController`). */
	private kill(alien: Alien) {
		this.aliens.delete(alien.model);
		this.alienCount(this.aliens.size());
		alien.shield?.bubble.Destroy();
		const splash = math.clamp(alien.model.GetExtentsSize().Magnitude / 2, 4, 16);
		shotMessaging.client.emitAll(ShotMessage.Blast, { at: alien.root.Position, splash });
		alien.model.Parent = this.baseService.wrecksFolder;
		Debris.AddItem(alien.model, WRECK_SECONDS);
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
		this.maxStage = planet ? MAX_STAGES[math.clamp(planet.difficulty, 0, MAX_STAGES.size() - 1)] : 1;
		if (map && this.costs?.map !== map) {
			// Worked out a slice a frame. Till then there's no field: walkers head straight for the Core.
			this.costs = undefined;
			this.field = new Array<number>(GRID_SIZE * GRID_SIZE, -1);
			task.spawn(() => {
				const costs = terrainCosts(map);
				if (this.planetsService.currentMap() === map) this.costs = { map, costs };
			});
		}
		this.wave(0);
		this.waves(planet ? BASE_WAVES + WAVES_PER_DIFFICULTY * planet.difficulty : 0);
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

		const cleared = this.pending.isEmpty() && this.aliens.isEmpty();
		if (this.wave() < this.waves()) {
			// The countdown runs once the last wave is cleared (the first's from the start, see `begin`).
			if (this.nextWaveAt() === 0 && cleared) this.nextWaveAt(Workspace.GetServerTimeNow() + WAVE_SECONDS);
			else if (this.nextWaveAt() > 0 && Workspace.GetServerTimeNow() >= this.nextWaveAt()) this.launch();
		}
		this.spawnPending(map, dt);
		this.refreshField();
		this.moveAliens(map, dt);
		this.fireTurrets(map, dt);
		this.landProjectiles();

		if (!this.liberated() && this.wave() >= this.waves() && this.pending.isEmpty() && this.aliens.isEmpty()) {
			this.baseService.end("won");
		}
	}

	/** How much tougher than the planet's first wave its current one is (see `HEALTH_RAMP`). */
	private waveScale(): number {
		const waves = this.waves();
		return waves > 1 ? 1 + (HEALTH_RAMP * math.max(this.wave() - 1, 0)) / (waves - 1) : 1;
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
		const maxHealth = math.round(def.health * this.healthScale * this.waveScale());
		const y = map.heightAt(x, z) + def.hover;
		// Landing facing the Core, so it doesn't start by turning round.
		const toCore = new Vector3(map.landing.X - x, 0, map.landing.Z - z);
		const facing = toCore.Magnitude > 1e-3 ? toCore.Unit : new Vector3(0, 0, -1);
		const at = new Vector3(x, y, z);
		const [model, root] = alienModel(
			kind,
			def.air ? CFrame.lookAt(at, at.add(facing)) : groundFrame(map, x, z, def.hover, facing),
		);
		model.SetAttribute("Kind", kind);
		setHealth(model, maxHealth, maxHealth);
		let shield: Shield | undefined;
		if (def.shield) {
			const max = math.round(def.shield.health * this.healthScale * this.waveScale());
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
			radius: footprint(kind, root.Size),
			facing,
			y,
			pitch: 0,
			roll: 0,
			velocity: Vector3.zero,
			cooldown: 0,
			// Each on its own clock from the start, so they don't all fire at once.
			weapons: (def.guns ?? []).map((gun) => ({ gun, cooldown: random.NextNumber(0, gun.rate) })),
			mounts: alienTurrets(kind),
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

	/**
	 * Rebuilds the flowfield after buildings change, at most every `FIELD_SECONDS`, a slice a frame
	 * (see `buildFlowfield`). Aliens follow the last one until it's done.
	 */
	private refreshField() {
		const revision = this.baseService.revision;
		const costs = this.costs;
		if (
			this.fieldBuilding ||
			revision === this.fieldRevision ||
			os.clock() - this.fieldAt < FIELD_SECONDS ||
			!costs
		)
			return;
		this.fieldRevision = revision;
		this.fieldAt = os.clock();
		const targets = new Array<number>();
		// What blocks the way: everything but belts, which aliens walk over.
		const solid = new Map<number, Building>();
		for (const [cell, building] of this.baseService.cells) {
			if (building.kind === "core") targets.push(cell);
			if (!BUILDINGS[building.kind].walkable) solid.set(cell, building);
		}
		this.fieldBuilding = true;
		task.spawn(() => {
			const field = buildFlowfield(costs.costs, solid, targets);
			this.fieldBuilding = false;
			// A new map meanwhile has costs of its own, and a field of its own to come.
			if (this.costs === costs) this.field = field;
		});
	}

	private moveAliens(map: PlanetMap, dt: number) {
		const players = livePlayers();
		// Every alien still alive once it's moved, to be pushed apart and put where it's got to.
		const moved = new Array<Alien>();

		// Where carriers drop crawlers, landed once every alien has moved: none join the map mid-loop.
		const drops = new Array<Vector3>();

		for (const [, alien] of this.aliens) {
			const { def } = alien;
			const reach = def.reach ?? 0;
			alien.cooldown -= dt;
			if (alien.shield) recharge(alien.shield, dt);
			const here = new Vector3(alien.x, alien.root.Position.Y, alien.z);
			const from = new Vector3(alien.x, alien.y, alien.z);

			// Its guns fire on the move: its turrets turn to aim them, never its legs.
			for (const weapon of alien.weapons) {
				weapon.cooldown -= dt;
				if (weapon.cooldown <= 0) this.trigger(alien, weapon, players);
			}
			if (def.attack === "bomb") {
				if (alien.cooldown <= 0 && this.bomb(map, alien)) alien.cooldown = def.rate;
			} else if (def.attack === "drop") {
				if (alien.cooldown <= 0 && alien.cargo > 0) {
					alien.cooldown = def.rate;
					for (let i = 0; i < math.min(DROP_COUNT, alien.cargo); i++) drops.push(here);
					alien.cargo = math.max(alien.cargo - DROP_COUNT, 0);
				}
			} else if (def.attack !== undefined && alien.cooldown <= 0) {
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

			if (def.aircraft) {
				steer(map, alien, dt);
			} else if (def.air) {
				// Straight for the Core, over walls and all.
				walk(alien, map.landing.add(alien.offset), dt);
			} else {
				const cell = cellAt(alien.x, alien.z);
				const step = cell === undefined ? -1 : this.field[cell];
				const target = step >= 0 ? cellCenter(step) : map.landing;
				const building = this.solidAt(step);
				if (building && flatDistance(target, here) <= CELL_STUDS / 2 + reach) {
					// Its path runs through a building: it stops to chew through it, or blow it up.
					turnToward(alien, new Vector3(target.X - alien.x, 0, target.Z - alien.z), dt);
					if (alien.cooldown <= 0 && def.attack === "explode") {
						this.explode(alien);
						continue;
					}
					if (alien.cooldown <= 0) {
						this.baseService.damage(building, def.damage);
						alien.cooldown = def.rate;
					}
				} else {
					walk(alien, (building ? target : this.ahead(here, step, map)).add(alien.offset), dt);
				}
			}

			if (def.air) fly(map, alien, from, dt);
			alien.velocity = new Vector3(alien.x, alien.y, alien.z).sub(from).div(dt);
			moved.push(alien);
		}

		this.separate(moved, dt);
		Workspace.BulkMoveTo(
			moved.map((alien) => alien.root),
			moved.map((alien) => bodyFrame(map, alien)),
			Enum.BulkMoveMode.FireCFrameChanged,
		);
		for (const at of drops) {
			if (this.aliens.size() >= MAX_ALIENS) break;
			this.spawn(map, "crawler", at.X + random.NextNumber(-3, 3), at.Z + random.NextNumber(-3, 3));
		}
	}

	/**
	 * Pushes apart aliens standing in each other, each kept its `radius` clear across the ground, the
	 * smaller giving way more: crowds spread out round what they're chewing on, and a flier only meets
	 * those near its own height.
	 * ponytail: checks every pair, cheap at `MAX_ALIENS`; bucket aliens by cell if the cap rises past a few hundred.
	 */
	private separate(aliens: ReadonlyArray<Alien>, dt: number) {
		for (let i = 0; i < aliens.size(); i++) {
			const a = aliens[i];
			for (let j = i + 1; j < aliens.size(); j++) {
				const b = aliens[j];
				const apart = a.radius + b.radius;
				const dx = b.x - a.x;
				const dz = b.z - a.z;
				if (math.abs(dx) >= apart || math.abs(dz) >= apart) continue;
				if (math.abs(a.root.Position.Y - b.root.Position.Y) >= apart) continue;
				const distance = math.sqrt(dx * dx + dz * dz);
				if (distance >= apart) continue;
				// Right on top of each other, any way apart will do.
				const nx = distance > 1e-3 ? dx / distance : 1;
				const nz = distance > 1e-3 ? dz / distance : 0;
				const push = math.min(apart - distance, SHOVE_SPEED * dt);
				// By area: a crawler gives way to a Titan, not the other way round.
				const share = b.radius ** 2 / (a.radius ** 2 + b.radius ** 2);
				this.shove(a, -nx * push * share, -nz * push * share);
				this.shove(b, nx * push * (1 - share), nz * push * (1 - share));
			}
		}
	}

	/** Moves an alien by (dx, dz) where it can go (see `open`), or failing that along just one, so it slides along a building's side. */
	private shove(alien: Alien, dx: number, dz: number) {
		const x = alien.x + dx;
		const z = alien.z + dz;
		if (this.open(alien, x, z)) {
			alien.x = x;
			alien.z = z;
		} else if (this.open(alien, x, alien.z)) {
			alien.x = x;
		} else if (this.open(alien, alien.x, z)) {
			alien.z = z;
		}
	}

	/** Whether an alien can be pushed to (x, z): a flier anywhere, a walker on the map and off any building it wasn't already on. */
	private open(alien: Alien, x: number, z: number): boolean {
		if (alien.def.air) return true;
		const cell = cellAt(x, z);
		return (
			cell !== undefined && (!this.solidAt(cell) || this.solidAt(cellAt(alien.x, alien.z) ?? -1) !== undefined)
		);
	}

	/** The building on `cell` that's in aliens' way, if any: anything but what they walk over. */
	private solidAt(cell: number): Building | undefined {
		const building = cell >= 0 ? this.baseService.cells.get(cell) : undefined;
		return building && !BUILDINGS[building.kind].walkable ? building : undefined;
	}

	/**
	 * Where a walker at `from` stepping onto `step` steers for: as far on down the flowfield as
	 * `LOOKAHEAD` cells of open ground go, so it cuts across the path's corners, unless the way there
	 * cuts through a building's. At the Core, the Core.
	 */
	private ahead(from: Vector3, step: number, map: PlanetMap): Vector3 {
		if (step < 0) return map.landing;
		let ahead = step;
		for (let i = 1; i < LOOKAHEAD; i++) {
			const after = this.field[ahead];
			if (after < 0 || this.solidAt(after)) break;
			ahead = after;
		}
		const there = cellCenter(ahead);
		// ponytail: checks the halfway point only, which is where a corner gets cut with two cells' lookahead.
		const halfway = cellAt((from.X + there.X) / 2, (from.Z + there.Z) / 2);
		return halfway !== undefined && this.solidAt(halfway) ? cellCenter(step) : there;
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
			const { damage, splash = 0 } = alien.def;
			// Straight down: the curve's bend is halfway.
			const control = from.add(ground).div(2);
			this.loft({ kind: "shell", from, control, to: ground, damage, splash, hostile: true }, BOMB_SECONDS);
			return true;
		}
		return false;
	}

	/**
	 * Puts a shot in the air, to land in `seconds` (see `landProjectiles`), and has clients draw its
	 * flight. The time starts now, so the server lands it about when clients see it come down.
	 */
	private loft(shot: Omit<Projectile, "id" | "fired" | "lands">, seconds: number) {
		const id = this.shotId++;
		const fired = os.clock();
		this.projectiles.push({ ...shot, id, fired, lands: fired + seconds });
		const { kind, from, control, to, target, splash, size, turret, barrel } = shot;
		shotMessaging.client.emitAll(ShotMessage.Fired, {
			id,
			kind,
			from,
			control,
			to,
			target: target?.model,
			seconds,
			splash,
			size,
			turret,
			barrel,
		});
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
	 * A gun's turn: it fires (see `fire`), then waits its `rate`, or with nothing to shoot looks again
	 * soon. When its aim moves enough to see, clients hear of it, to turn its turret after it (see
	 * `AlienController`).
	 */
	private trigger(alien: Alien, weapon: Weapon, players: ReadonlyArray<[Vector3, Humanoid]>) {
		const { gun } = weapon;
		const at = this.fire(alien, gun, players);
		weapon.cooldown = at ? gun.rate : RETARGET_SECONDS;
		const moved = at && weapon.at ? at.sub(weapon.at).Magnitude > AIM_SLACK : at !== weapon.at;
		if (!moved) return;
		weapon.at = at;
		if (gun.turret !== undefined) alien.model.SetAttribute(`Aim${gun.turret}`, at);
	}

	/**
	 * Fires `gun` at the nearest thing it can reach (see `nearest`), out of its barrel: its turret's,
	 * as though turned to face it, or the hull's middle. Point defence shoots a shot down instead (see
	 * `intercept`). Returns where it aimed, if anywhere.
	 */
	private fire(alien: Alien, gun: Gun, players: ReadonlyArray<[Vector3, Humanoid]>): Vector3 | undefined {
		const mounted = gun.turret !== undefined ? alien.mounts[gun.turret] : undefined;
		const mount = mounted ? alien.root.CFrame.mul(mounted[0]) : alien.root.CFrame;
		const barrel = (to: Vector3) =>
			mounted ? mount.Position.add(to.sub(mount.Position).Unit.mul(mounted[1])) : alien.root.Position;
		if (gun.kind === "intercept") return this.intercept(mount, gun, barrel);

		// Buildings over players: a player only draws fire with no building in reach.
		const mark =
			(gun.prefers === "turrets" ? this.nearest(mount, gun, players, "turrets") : undefined) ??
			this.nearest(mount, gun, players, "buildings") ??
			this.nearest(mount, gun, players, "players");
		if (!mark) return undefined;
		const to = mark.at;
		const from = barrel(to);
		const distance = to.sub(from).Magnitude;
		const { damage, splash = 0 } = gun;
		if (gun.kind === "shell") {
			const control = from
				.add(to)
				.div(2)
				.add(new Vector3(0, distance * 0.6, 0));
			this.loft(
				{ kind: "shell", from, control, to, damage, splash, hostile: true },
				LAUNCH_SECONDS + distance / SHELL_SPEED,
			);
		} else if (gun.kind === "rocket") {
			// Each veering off to a side, turn and turn about, before curving down.
			const across = new Vector3(from.Z - to.Z, 0, to.X - from.X);
			const side = across.Magnitude > 1e-3 ? across.Unit : Vector3.xAxis;
			for (let i = 0; i < (gun.salvo ?? 2); i++) {
				const veer = side
					.mul((i % 2 === 0 ? -1 : 1) * random.NextNumber(0.1, 0.35) * distance)
					.add(new Vector3(0, distance * 0.2, 0));
				const control = from.add(to).div(2).add(veer);
				this.loft(
					{ kind: "rocket", from, control, to, damage, splash, hostile: true },
					LAUNCH_SECONDS + distance / ROCKET_SPEED,
				);
			}
		} else {
			shotMessaging.client.emitAll(ShotMessage.Hit, { from, to, size: gun.size ?? 1, hostile: true });
			if (mark.humanoid) mark.humanoid.TakeDamage(damage);
			else if (mark.building) this.baseService.damage(mark.building, damage);
		}
		return to;
	}

	/**
	 * The nearest of `among` (turrets, any building, or players) that `gun`, on a turret resting at
	 * `mount`, can reach: within its range across the ground, and its arc.
	 */
	private nearest(
		mount: CFrame,
		gun: Gun,
		players: ReadonlyArray<[Vector3, Humanoid]>,
		among: "turrets" | "buildings" | "players",
	): Mark | undefined {
		const pivot = mount.Position;
		let best = gun.range;
		let mark: Mark | undefined;
		if (among === "players") {
			for (const [at, humanoid] of players) {
				const distance = flatDistance(at, pivot);
				if (distance >= best || !inArc(mount, at, gun.arc)) continue;
				best = distance;
				mark = { at, humanoid };
			}
			return mark;
		}
		// ponytail: scans every building per shot; bucket buildings by cell if bases grow to thousands.
		for (const building of this.baseService.buildings) {
			if (among === "turrets" && !BUILDINGS[building.kind].turret) continue;
			const distance = flatDistance(building.position, pivot);
			if (distance >= best || !inArc(mount, building.position, gun.arc)) continue;
			best = distance;
			mark = { at: building.position, building };
		}
		return mark;
	}

	/**
	 * Point defence: shoots the nearest turret rocket or shell within `gun`'s range, and its arc, out of
	 * the air, so it never lands, and has clients draw it go. Returns where it was, if there was one.
	 */
	private intercept(mount: CFrame, gun: Gun, barrel: (to: Vector3) => Vector3): Vector3 | undefined {
		const pivot = mount.Position;
		const now = os.clock();
		let best = gun.range;
		let downed: Projectile | undefined;
		let at = pivot;
		for (const shot of this.projectiles) {
			// Flak flies at fliers, never near it, and bullets and flames are too quick and small to shoot.
			if (shot.hostile || (shot.kind !== "rocket" && shot.kind !== "shell")) continue;
			const t = math.clamp((now - shot.fired) / (shot.lands - shot.fired), 0, 1);
			const position = bezier(shot.from, shot.control, shot.to, t);
			const distance = position.sub(pivot).Magnitude;
			if (distance >= best || !inArc(mount, position, gun.arc)) continue;
			best = distance;
			downed = shot;
			at = position;
		}
		if (!downed) return undefined;
		this.projectiles.remove(this.projectiles.indexOf(downed));
		shotMessaging.client.emitAll(ShotMessage.Downed, { id: downed.id, from: barrel(at) });
		return at;
	}

	/**
	 * Every loaded turret tracks the nearest alien in range that it can hit (see `canHit`), or the
	 * toughest for one that picks it out, keeping it till it's gone or a better one comes along:
	 * its head turns after where its shots will meet it, no faster than its `turn`, and clients see
	 * which (see `TurretController`). Once cooled down and near enough on target, it shoots where its
	 * guns point, so one that can't keep up misses. Its ammo sets the damage, with its placer's
	 * research, and can stretch its range and change its rate. A power turret reloads slower on less
	 * power. Every shot is a projectile, which lands later, but a laser's beam and an arc's
	 * lightning, which strike at once.
	 */
	private fireTurrets(map: PlanetMap, dt: number) {
		for (const turret of this.baseService.buildings) {
			const def = BUILDINGS[turret.kind];
			const gun = def.turret;
			const head = turret.head;
			if (!gun || !head) continue;
			const ammo = this.baseService.nextAmmo(turret);
			const from = head.Position;
			const range = (def.range ?? 0) + (ammo?.range ?? 0);
			const target = ammo && this.track(turret, gun, from, range, dt);
			turret.engaged = target !== undefined;
			setTarget(turret.model, target?.model);
			if (gun.spinUp !== undefined) {
				// Winds up while it has something to shoot, and down while it hasn't.
				const step = turret.engaged ? dt / gun.spinUp : -dt / SPIN_DOWN_SECONDS;
				turret.spin = math.clamp(turret.spin + step, 0, 1);
			}
			if (!ammo) continue;
			turret.cooldown -= dt * (gun.energy ? turret.power : 1);
			if (gun.beam !== undefined) {
				this.fireBeam(turret, gun, from, range, target, ammo.damage, dt);
				continue;
			}
			if (!target) continue;

			const at = target.root.Position;
			const speed = shotSpeed(gun);
			const lead = speed !== undefined ? at.add(target.velocity.mul(at.sub(from).Magnitude / speed)) : at;
			const want = turretAim(gun, from, lead);
			turret.aim = turnHead(gun, turret.aim, want, dt);
			if (turret.cooldown > 0) continue;
			const aim = aimFrame(from, turret.aim);
			if (aim.LookVector.Dot(aimFrame(from, want).LookVector) < FIRE_CONE) continue;
			// Each shot from the next barrel round, and each of a volley from its own.
			const fired = turret.fired;
			const barrel = (index: number) => (fired + index) % math.max(turret.muzzles.size(), 1);
			const muzzle = (index: number) => {
				const tip = turret.muzzles[barrel(index)];
				return tip ? aim.mul(tip) : aim;
			};
			// A burst's shots come in quick succession, then it reloads. One that spins up fires faster as it winds.
			turret.burst = (turret.burst + 1) % (gun.burst ?? 1);
			const spin = gun.spinUp !== undefined ? SPIN_SLOWEST + (1 - SPIN_SLOWEST) * turret.spin : 1;
			const rate = spin * (ammo.rate ?? 1);
			turret.cooldown = turret.burst === 0 ? gun.seconds / rate : (gun.gap ?? BURST_SECONDS);
			const damage = ammo.damage * statOf(turret.owner, "turretDamage");
			this.baseService.shoot(turret);
			if (gun.projectile === "arc") {
				this.zap(muzzle(0).Position, target, damage, ammo.chain ?? 0, gun.targets);
				continue;
			}
			const volley = gun.volley ?? 1;
			for (let i = 0; i < volley; i++) {
				// Fanned evenly either side of the aim.
				const turn = (i - (volley - 1) / 2) * (gun.fan ?? 0);
				this.loose(map, muzzle(i), aim, target, gun, ammo, {
					damage,
					range,
					turn,
					size: def.size,
					turret: turret.model,
					barrel: barrel(i),
				});
			}
		}
	}

	/**
	 * A beam laser, like Mindustry's Meltdown: reloaded (slower on less power) and with `target`
	 * within `BEAM_CONE` of its sights, it lights its beam, which burns on for its `beam` seconds,
	 * pulsing damage into every alien along it, wherever its head points: it sweeps after its target,
	 * or the next, at `BEAM_TURN` of its speed, and burns on even with none. Then it reloads.
	 */
	private fireBeam(
		turret: Building,
		gun: TurretDef,
		from: Vector3,
		range: number,
		target: Alien | undefined,
		damage: number,
		dt: number,
	) {
		const beam = gun.beam!;
		const burning = turret.burning > 0;
		if (target) {
			const want = turretAim(gun, from, target.root.Position);
			turret.aim = turnHead(gun, turret.aim, want, dt * (burning ? BEAM_TURN : 1));
			const sighted = aimFrame(from, turret.aim).LookVector.Dot(aimFrame(from, want).LookVector) >= BEAM_CONE;
			if (!burning && turret.cooldown <= 0 && sighted) {
				turret.burning = beam;
				turret.cooldown = 0;
				turret.model.SetAttribute("Burning", true);
			}
		}
		if (turret.burning <= 0) return;
		turret.burning -= dt;
		if (turret.burning <= 0) {
			turret.cooldown = gun.seconds;
			turret.model.SetAttribute("Burning", undefined);
			return;
		}
		// Pulses its damage, slower on less power.
		if (turret.cooldown > 0) return;
		turret.cooldown = BEAM_PULSE;
		const aim = aimFrame(from, turret.aim);
		const tip = turret.muzzles[0];
		// It reaches out as it lights and draws back in as it goes out.
		const reach = math.min((beam - turret.burning) / BEAM_FADE, turret.burning / BEAM_FADE, 1);
		this.baseService.shoot(turret);
		const muzzle = (tip ? aim.mul(tip) : aim).Position;
		const hurt = damage * statOf(turret.owner, "turretDamage");
		this.burn(turret.model, muzzle, aim.LookVector, range, hurt, gun.targets, reach);
	}

	/**
	 * The alien a turret tracks: the one it has while it's alive and in range, or, every
	 * `RETARGET_SECONDS`, the nearest it can hit (the toughest, for one that picks it out).
	 */
	private track(turret: Building, gun: TurretDef, from: Vector3, range: number, dt: number): Alien | undefined {
		const held = turret.target && this.aliens.get(turret.target);
		const holds = held !== undefined && flatDistance(held.root.Position, from) < range;
		turret.retarget -= dt;
		if (holds && turret.retarget > 0) return held;
		turret.retarget = RETARGET_SECONDS;
		let best = math.huge;
		let target: Alien | undefined;
		for (const [, alien] of this.aliens) {
			const distance = flatDistance(alien.root.Position, from);
			if (distance >= range || !canHit(gun.targets, alien)) continue;
			const score = gun.strongest ? -alien.health : distance;
			if (score >= best) continue;
			best = score;
			target = alien;
		}
		turret.target = target?.model;
		return target;
	}

	/**
	 * Fires a projectile out of `muzzle` at `target`, which lands once clients have drawn its flight.
	 * Where it goes is where the turret's head points (`aim`), not where the target is: off target,
	 * it misses. A bullet or flame flies straight that way as far as where the target will be by
	 * then, turned `turn` degrees for a fan, and hits whatever is there when it arrives (see
	 * `landProjectiles`): one that pierces flies on to the end of the turret's `range`. A rocket
	 * shoots out the front, veering off to a random side before curving round into the target,
	 * chasing it; a shell arcs high and comes down as far off as the target stood that way, anywhere
	 * within the turret's `spread`; flak flies straight and fast that way as far as where the target
	 * will be, bursting anywhere within `spread`. Homing ammo chases its target whatever it is, so it
	 * never misses.
	 */
	private loose(
		map: PlanetMap,
		muzzle: CFrame,
		aim: CFrame,
		target: Alien,
		gun: TurretDef,
		ammo: EnergyDef,
		shot: {
			readonly damage: number;
			readonly range: number;
			readonly turn: number;
			readonly size: number;
			readonly turret: Model;
			readonly barrel: number;
		},
	) {
		const from = muzzle.Position;
		const at = target.root.Position;
		const distance = at.sub(from).Magnitude;
		const homing = ammo.homing === true;
		let to = at;
		let control: Vector3;
		let seconds: number;
		const speed = shotSpeed(gun) ?? 1;
		// As far as where the target will be when the shot gets there.
		const reach = at.add(target.velocity.mul(distance / speed)).sub(from).Magnitude;
		if (gun.projectile === "bullet" || gun.projectile === "flame") {
			const along = CFrame.Angles(0, math.rad(shot.turn), 0).VectorToWorldSpace(aim.LookVector);
			to = homing ? at : from.add(along.mul(ammo.pierce !== undefined ? shot.range : reach));
			control = from.add(to).div(2);
			seconds = to.sub(from).Magnitude / speed;
		} else if (gun.projectile === "rocket") {
			const ahead = muzzle.LookVector.mul(distance * 0.5);
			const veer = muzzle.RightVector.mul(random.NextNumber(-0.3, 0.3) * distance);
			control = from
				.add(ahead)
				.add(veer)
				.add(new Vector3(0, random.NextNumber(2, 8), 0));
			seconds = LAUNCH_SECONDS + distance / ROCKET_SPEED;
		} else if (gun.projectile === "flak") {
			// Strays: evenly through the ball, not bunched at its middle.
			const burst = from.add(aim.LookVector.mul(reach));
			to = burst.add(random.NextUnitVector().mul((gun.spread ?? 0) * random.NextNumber() ** (1 / 3)));
			control = from.add(to).div(2);
			seconds = to.sub(from).Magnitude / speed;
		} else {
			// Evenly over the circle, not bunched at its middle. Homing shells come down on the target.
			const across = new Vector3(at.X - from.X, 0, at.Z - from.Z).Magnitude;
			const flat = new Vector3(aim.LookVector.X, 0, aim.LookVector.Z).Unit;
			const centre = homing ? at : from.add(flat.mul(across));
			const angle = random.NextNumber(0, 2 * math.pi);
			const off = homing ? 0 : (gun.spread ?? 0) * math.sqrt(random.NextNumber());
			const x = centre.X + math.cos(angle) * off;
			const z = centre.Z + math.sin(angle) * off;
			to = new Vector3(x, map.heightAt(x, z), z);
			control = from
				.add(to)
				.div(2)
				.add(new Vector3(0, distance * 0.6, 0));
			seconds = LAUNCH_SECONDS + distance / SHELL_SPEED;
		}
		const straight = gun.projectile === "bullet" || gun.projectile === "flame";
		this.loft(
			{
				// Lasers and arcs never get here (see `fireTurrets`).
				kind: gun.projectile as Shot["kind"],
				from,
				control,
				to,
				target: gun.projectile === "rocket" || homing ? target : undefined,
				damage: shot.damage,
				splash: ammo.splash ?? 0,
				targets: gun.targets,
				pierce: ammo.pierce,
				size: straight ? shot.size : undefined,
				turret: shot.turret,
				barrel: shot.barrel,
			},
			seconds,
		);
	}

	/**
	 * Lands the shots that are due. An alien's hurts the buildings and players within its splash of
	 * where it comes down. A turret's hurts the aliens it can hit: every one within its splash, or a
	 * bullet's the one it meets, if any, or a piercing bullet's those along its flight.
	 */
	private landProjectiles() {
		const now = os.clock();
		this.projectiles = this.projectiles.filter((shot) => {
			if (shot.target && this.aliens.has(shot.target.model)) shot.to = shot.target.root.Position;
			if (now < shot.lands) return true;
			if (shot.hostile) this.blastBase(shot.to, shot.splash, shot.damage);
			else if (shot.pierce !== undefined)
				this.pierceAliens(shot.from, shot.to, shot.damage, shot.targets, shot.pierce);
			else if (shot.splash > 0) this.blastAliens(shot.to, shot.splash, shot.damage, shot.targets);
			else this.hitAlien(shot.to, shot.damage, shot.targets);
			return false;
		});
	}

	/** Hurts the alien a bullet landing at `at` meets: the nearest it can hit whose body reaches there, if any. */
	private hitAlien(at: Vector3, damage: number, targets: "air" | "ground" | undefined) {
		let best = math.huge;
		let hit: Alien | undefined;
		for (const [, alien] of this.aliens) {
			const off = alien.root.Position.sub(at).Magnitude;
			if (off > alien.radius + BULLET_SLACK || off >= best || !canHit(targets, alien)) continue;
			best = off;
			hit = alien;
		}
		if (hit) this.damageAlien(hit.model, damage);
	}

	/**
	 * Hurts the aliens a piercing bullet or a laser passed through from `from` to `to`, nearest
	 * `from` first: those it can hit whose body reaches its line, up to one more than it pierces.
	 * They're where they are as it lands.
	 */
	private pierceAliens(
		from: Vector3,
		to: Vector3,
		damage: number,
		targets: "air" | "ground" | undefined,
		pierce: number,
	) {
		const line = to.sub(from);
		const length = line.Magnitude;
		if (length < 1e-3) return;
		const along = line.div(length);
		const struck = new Array<[number, Alien]>();
		for (const [, alien] of this.aliens) {
			if (!canHit(targets, alien)) continue;
			const offset = alien.root.Position.sub(from);
			const t = math.clamp(offset.Dot(along), 0, length);
			if (offset.sub(along.mul(t)).Magnitude <= alien.radius + BULLET_SLACK) struck.push([t, alien]);
		}
		struck.sort((a, b) => a[0] < b[0]);
		for (let i = 0; i < math.min(struck.size(), pierce + 1); i++) this.damageAlien(struck[i][1].model, damage);
	}

	/** A laser's pulse: burns every alien it can hit along its beam, from `from` out `along` to `range`, drawn `reach` (0 to 1) of the way out. */
	private burn(
		turret: Model,
		from: Vector3,
		along: Vector3,
		range: number,
		damage: number,
		targets: "air" | "ground" | undefined,
		reach: number,
	) {
		const to = from.add(along.mul(range));
		this.pierceAliens(from, to, damage, targets, math.huge);
		shotMessaging.client.emitAll(ShotMessage.Beam, { turret, from, to, reach });
	}

	/** Lightning: strikes `target`, then leaps `chain` times on to the nearest alien it can hit within `ARC_JUMP` of the last. */
	private zap(from: Vector3, target: Alien, damage: number, chain: number, targets: "air" | "ground" | undefined) {
		const points = [from];
		const struck = new Set<Alien>();
		let striking: Alien | undefined = target;
		while (striking && struck.size() <= chain) {
			const at = striking.root.Position;
			struck.add(striking);
			points.push(at);
			this.damageAlien(striking.model, damage);
			let best = ARC_JUMP;
			striking = undefined;
			for (const [, alien] of this.aliens) {
				const distance = alien.root.Position.sub(at).Magnitude;
				if (distance >= best || struck.has(alien) || !canHit(targets, alien)) continue;
				best = distance;
				striking = alien;
			}
		}
		shotMessaging.client.emitAll(ShotMessage.Arc, { points });
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
