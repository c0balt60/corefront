import type { ResourceId, ResourceStack } from "game/Base/shared/resources";
import type { GlyphId } from "game/Research/shared/research";
import { CELL_STUDS, cellCenter } from "game/Terrain/shared/map";

/*
 * The server keeps the planet's gameplay instances in `Workspace.Base`:
 * - `Base.Buildings`: one Model per building, with attributes `Kind` (BuildingKind),
 *   `Cell` (the -X/-Z corner cell, see map.ts), `Rotation`, `Health` and `MaxHealth`. Drills and
 *   crafters also have `Resource` (what they make) and `Stored`, drills `Yield` (per tick), crafters
 *   `Input_<resource>` for each input, generators for each fuel and storage for each ore it holds,
 *   turrets `Ammo` (shots held), `AmmoType` (the ore they fire next) and a `Target` ObjectValue
 *   (the alien they track, whose head clients turn after it), sorters, sources and
 *   unloaders `Filter`, and belts `Entry`, `PathIn`, `PathMid`, `PathOut` and `PathEnds` (see
 *   `BeltPath`). Power: what uses it has `Power` (the share of its need it gets, 0 to 1), generators
 *   `PowerOut` (per second), batteries `Charge`, and nodes `Links` and their network's `Produced`,
 *   `Demand` (per second) and `Stored`.
 * - `Base.Aliens`: one Model per alien, with `Kind` (AlienKind), `Health` and `MaxHealth`, and for
 *   each of its turrets (`Turret0` on) an `Aim0` on: where that turret's gun aims, if anywhere.
 * Ore deposits are Models tagged "Ore" (CollectionService), with attributes `Resource` and `Cell`.
 */

export type BuildingKind =
	| "core"
	| "drill"
	| "advancedDrill"
	| "laserDrill"
	| "conveyor"
	| "titaniumConveyor"
	| "router"
	| "sorter"
	| "junction"
	| "source"
	| "container"
	| "vault"
	| "unloader"
	| "graphitePress"
	| "siliconSmelter"
	| "kiln"
	| "pulverizer"
	| "pyratiteMixer"
	| "combustionGenerator"
	| "solarPanel"
	| "rtgGenerator"
	| "battery"
	| "largeBattery"
	| "powerNode"
	| "largePowerNode"
	| "wall"
	| "titaniumWall"
	| "turret"
	| "autoTurret"
	| "scatter"
	| "vulcan"
	| "cannon"
	| "swarmer"
	| "ripple"
	| "hail"
	| "scorch"
	| "fuse"
	| "salvo"
	| "reaper"
	| "harbinger"
	| "arc"
	| "meltdown"
	| "mender";
export type BuildableKind = Exclude<BuildingKind, "core">;

export interface BuildingDef {
	readonly name: string;
	readonly description: string;
	readonly cost: ReadonlyArray<ResourceStack>;
	readonly health: number;
	/** Width and depth, in cells. */
	readonly size: number;
	/** Studs, for buildings that reach out (shown round the ghost). */
	readonly range?: number;
	/** Turrets: see `TurretDef`. They shoot within `range`, plus their ammo's. */
	readonly turret?: TurretDef;
	/** Drills, which must go on ore: mined per tick for each cell of its ore under them, and the most they hold. */
	readonly drill?: { readonly yield: number; readonly storage: number };
	/** Crafters: each tick, the `inputs` become one `output`. They hold up to `storage` of each. */
	readonly craft?: {
		readonly inputs: ReadonlyArray<ResourceStack>;
		readonly output: ResourceId;
		readonly storage: number;
	};
	/** Belts: cells per second ore rides them. */
	readonly belt?: number;
	/** Walls join the walls beside them. */
	readonly wall?: true;
	/** Health given back per tick to every damaged building within `range`. */
	readonly repair?: number;
	/** Aliens walk over it: it never blocks their path, and they never chew it. */
	readonly walkable?: true;
	/** It hands ore out to whatever is beside it, so belts there turn to take it. */
	readonly outputs?: true;
	/**
	 * Power it uses per second while it works. It works at the share of that its network can give
	 * (see `PowerService`), and not at all with none. Turrets only draw it while they have a target.
	 */
	readonly power?: number;
	/**
	 * Generators: power made per second. With `fuel`, it burns one item every `seconds`, the
	 * output scaled by that fuel's efficiency, and holds up to `storage` of each.
	 */
	readonly generator?: {
		readonly power: number;
		readonly fuel?: Partial<Record<ResourceId, number>>;
		readonly seconds?: number;
		readonly storage?: number;
	};
	/** Batteries: the most power they hold. */
	readonly battery?: number;
	/** Power nodes: the most links they make, each within `range` (see `linkReach`). */
	readonly node?: number;
	/** Storage: the most of each ore it holds. Unloaders take it back out. */
	readonly store?: number;
}

/**
 * One ore a turret fires, Mindustry style: each item loaded gives `shots` shots, each dealing
 * `damage`. It can change the turret's fire rate (times) and range (studs added), blast `splash`
 * studs round where it lands, home in on its target so it never misses, or (bullets) fly on to the
 * end of the turret's range through `pierce` more aliens after the first. Arcs jump on to `chain`
 * more aliens.
 */
export interface AmmoDef {
	readonly damage: number;
	readonly shots: number;
	readonly rate?: number;
	readonly range?: number;
	readonly splash?: number;
	readonly homing?: true;
	readonly pierce?: number;
	readonly chain?: number;
}

/** What a power turret's every shot does: an ammo with no items to load. */
export type EnergyDef = Omit<AmmoDef, "shots">;

/**
 * A turret: seconds between shots, and the most shots it holds of all its ammo together. Only the
 * ores in `ammo` load into it; it fires the one loaded last first. Each shot is a projectile:
 * bullets fly straight at `speed` for where their target is going, hitting whatever is there when
 * they arrive; flames are slow, short bullets; rockets curve into their target, shells arc down near
 * it and flak flies straight at where it is going, landing up to `spread` studs off. `volley` fly
 * at a time, fanned `fan` degrees apart. With a `burst`, it fires that many shots `gap` seconds
 * apart, and `seconds` is the reload after each burst. With a `spinUp`, it starts at a fifth of its
 * rate and winds up to it over that many seconds while it has a target, winding down without one.
 * It shoots only fliers or only ground aliens if `targets` says so, and the toughest alien in range,
 * not the nearest, if `strongest`. A power turret has no ammo: it fires `energy` while it has power,
 * reloading slower on less. Its lasers burn through everything along them at once, and its arcs
 * strike at once, jumping between aliens. Its head turns `turn` degrees a second to track its
 * target, and its shots fly where its guns point: one that can't keep up misses (see `turretAim`).
 */
export interface TurretDef {
	readonly turn: number;
	readonly seconds: number;
	readonly maxAmmo: number;
	readonly ammo: Partial<Record<ResourceId, AmmoDef>>;
	readonly energy?: EnergyDef;
	readonly projectile: "bullet" | "flame" | "rocket" | "shell" | "flak" | "laser" | "arc";
	readonly speed?: number;
	readonly burst?: number;
	readonly gap?: number;
	readonly spinUp?: number;
	readonly volley?: number;
	readonly spread?: number;
	readonly fan?: number;
	readonly targets?: "air" | "ground";
	readonly strongest?: true;
	/**
	 * A beam laser's (Mindustry's Meltdown): once reloaded, with a target near its sights, it lights a
	 * beam that burns on for this many seconds wherever its head points, target or not, then reloads
	 * for `seconds`. Its head turns at `BEAM_TURN` of its speed while it burns (see `WaveService`).
	 */
	readonly beam?: number;
	/** A railgun's: its rails flare and its slugs leave with a shockwave, but no casings (see `ShotController`). */
	readonly rail?: true;
}

/** Seconds between a beam's pulses of damage, and how fast its head turns while it burns, of its `turn` (see `TurretDef.beam`). */
export const BEAM_PULSE = 0.1;
export const BEAM_TURN = 0.5;

/** How fast bullets fly, in studs per second, unless their turret says (see `TurretDef.speed`), and flak. */
const BULLET_SPEED = 150;
const FLAK_SPEED = 160;

/** How fast a turret's shots fly straight at where their target is going, if they do: lasers, arcs, rockets and shells don't. */
export function shotSpeed(gun: TurretDef): number | undefined {
	if (gun.projectile === "bullet" || gun.projectile === "flame") return gun.speed ?? BULLET_SPEED;
	if (gun.projectile === "flak") return FLAK_SPEED;
	return undefined;
}

/** Turrets that lob or strike from on high keep their heads level; the rest tip theirs between these to aim. */
const LEVEL: ReadonlySet<TurretDef["projectile"]> = new Set(["shell", "rocket", "arc"]);
const LOWEST = math.rad(-35);
const HIGHEST = math.rad(80);

/** The yaw and pitch, in radians, a turret's head at `from` turns to, to aim at `at` (see `aimFrame`). */
export function turretAim(gun: TurretDef, from: Vector3, at: Vector3): [yaw: number, pitch: number] {
	const to = at.sub(from);
	const flat = math.sqrt(to.X ** 2 + to.Z ** 2);
	const pitch = LEVEL.has(gun.projectile) ? 0 : math.clamp(math.atan2(to.Y, flat), LOWEST, HIGHEST);
	return [math.atan2(-to.X, -to.Z), pitch];
}

/** Turns a head's (yaw, pitch) toward (yaw, pitch) `want`, by at most its turret's `turn` over `dt` seconds each way, yaw the short way round. */
export function turnHead(
	gun: TurretDef,
	[yaw, pitch]: readonly [number, number],
	[wantYaw, wantPitch]: readonly [number, number],
	dt: number,
): [yaw: number, pitch: number] {
	const step = math.rad(gun.turn) * dt;
	const yawOff = ((wantYaw - yaw + math.pi) % (2 * math.pi)) - math.pi;
	return [yaw + math.clamp(yawOff, -step, step), pitch + math.clamp(wantPitch - pitch, -step, step)];
}

/** A turret's head at `at`, turned to (yaw, pitch): it looks along -Z. */
export function aimFrame(at: Vector3, [yaw, pitch]: readonly [number, number]): CFrame {
	return new CFrame(at).mul(CFrame.Angles(0, yaw, 0)).mul(CFrame.Angles(pitch, 0, 0));
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
	core: {
		name: "Core",
		description: "Stores the team's resources. Lose it, lose the planet.",
		cost: [],
		health: 1500,
		size: 2,
	},
	drill: {
		name: "Drill",
		description: "Place on ore. Loads belts and buildings beside it, or fills up for you to collect.",
		cost: [{ resource: "copper", amount: 12 }],
		health: 200,
		size: 1,
		drill: { yield: 1, storage: 30 },
		outputs: true,
	},
	advancedDrill: {
		name: "Adv. Drill",
		description: "Place on ore. Mines twice as fast and holds more.",
		cost: [
			{ resource: "copper", amount: 20 },
			{ resource: "lead", amount: 12 },
		],
		health: 260,
		size: 1,
		drill: { yield: 2, storage: 60 },
		outputs: true,
	},
	laserDrill: {
		name: "Laser Drill",
		description: "Place over ore. Mines fast from every cell of ore under it. Needs power.",
		cost: [
			{ resource: "copper", amount: 40 },
			{ resource: "graphite", amount: 30 },
			{ resource: "silicon", amount: 20 },
		],
		health: 500,
		size: 2,
		drill: { yield: 3, storage: 120 },
		outputs: true,
		power: 66,
	},
	conveyor: {
		name: "Conveyor",
		description: "Carries ore the way it faces. Drag a line; across a belt it lays a Junction.",
		cost: [{ resource: "copper", amount: 2 }],
		health: 45,
		size: 1,
		belt: 1.25,
		walkable: true,
	},
	titaniumConveyor: {
		name: "Ti Conveyor",
		description: "A faster belt. Lay it over conveyors to upgrade them.",
		cost: [
			{ resource: "copper", amount: 2 },
			{ resource: "lead", amount: 1 },
			{ resource: "titanium", amount: 1 },
		],
		health: 65,
		size: 1,
		belt: 2.25,
		walkable: true,
	},
	router: {
		name: "Router",
		description: "Passes ore on to every side, taking turns.",
		cost: [{ resource: "copper", amount: 6 }],
		health: 120,
		size: 1,
		outputs: true,
	},
	sorter: {
		name: "Sorter",
		description: "Lets one ore straight through and turns the rest aside. Click it to pick the ore.",
		cost: [
			{ resource: "copper", amount: 6 },
			{ resource: "lead", amount: 4 },
		],
		health: 120,
		size: 1,
		outputs: true,
	},
	junction: {
		name: "Junction",
		description: "Lets two belt lines cross.",
		cost: [
			{ resource: "copper", amount: 6 },
			{ resource: "lead", amount: 2 },
		],
		health: 120,
		size: 1,
		outputs: true,
	},
	source: {
		name: "Source",
		description: "Sandbox only. Endlessly hands out the ore you pick to whatever is beside it. Click it to pick.",
		cost: [],
		health: 200,
		size: 1,
		outputs: true,
	},
	graphitePress: {
		name: "Graphite Press",
		description: "Presses 2 coal into 1 graphite, the hardest-hitting common ammo.",
		cost: [
			{ resource: "copper", amount: 40 },
			{ resource: "lead", amount: 25 },
		],
		health: 400,
		size: 2,
		craft: { inputs: [{ resource: "coal", amount: 2 }], output: "graphite", storage: 20 },
		outputs: true,
	},
	siliconSmelter: {
		name: "Si Smelter",
		description: "Smelts 2 sand, 1 coal and 1 lead into 1 silicon. Needs power.",
		cost: [
			{ resource: "copper", amount: 50 },
			{ resource: "lead", amount: 30 },
			{ resource: "graphite", amount: 20 },
		],
		health: 450,
		size: 2,
		craft: {
			inputs: [
				{ resource: "sand", amount: 2 },
				{ resource: "coal", amount: 1 },
				{ resource: "lead", amount: 1 },
			],
			output: "silicon",
			storage: 20,
		},
		outputs: true,
		power: 30,
	},
	kiln: {
		name: "Kiln",
		description: "Fires 1 lead and 1 sand into 1 metaglass. Needs power.",
		cost: [
			{ resource: "copper", amount: 60 },
			{ resource: "lead", amount: 30 },
			{ resource: "graphite", amount: 30 },
		],
		health: 300,
		size: 2,
		craft: {
			inputs: [
				{ resource: "lead", amount: 1 },
				{ resource: "sand", amount: 1 },
			],
			output: "metaglass",
			storage: 20,
		},
		outputs: true,
		power: 36,
	},
	pulverizer: {
		name: "Pulverizer",
		description: "Grinds 1 scrap into 1 sand. Needs power.",
		cost: [
			{ resource: "copper", amount: 30 },
			{ resource: "lead", amount: 25 },
		],
		health: 120,
		size: 1,
		craft: { inputs: [{ resource: "scrap", amount: 1 }], output: "sand", storage: 20 },
		outputs: true,
		power: 30,
	},
	pyratiteMixer: {
		name: "Pyratite Mixer",
		description: "Mixes 1 coal, 2 lead and 2 sand into 1 pyratite: incendiary ammo and strong fuel. Needs power.",
		cost: [
			{ resource: "copper", amount: 50 },
			{ resource: "lead", amount: 25 },
		],
		health: 300,
		size: 2,
		craft: {
			inputs: [
				{ resource: "coal", amount: 1 },
				{ resource: "lead", amount: 2 },
				{ resource: "sand", amount: 2 },
			],
			output: "pyratite",
			storage: 20,
		},
		outputs: true,
		power: 12,
	},
	container: {
		name: "Container",
		description: "Stores up to 300 of each ore. Belts fill it; Unloaders beside it take ore back out.",
		cost: [
			{ resource: "copper", amount: 60 },
			{ resource: "lead", amount: 50 },
		],
		health: 400,
		size: 2,
		store: 300,
	},
	vault: {
		name: "Vault",
		description: "Stores up to 1000 of each ore. Belts fill it; Unloaders beside it take ore back out.",
		cost: [
			{ resource: "titanium", amount: 125 },
			{ resource: "thorium", amount: 60 },
		],
		health: 1200,
		size: 3,
		store: 1000,
	},
	unloader: {
		name: "Unloader",
		description:
			"Takes ore out of a Container, Vault or the Core beside it, and hands it to everything else beside it. Click it to pick the ore, or take any.",
		cost: [
			{ resource: "copper", amount: 30 },
			{ resource: "graphite", amount: 20 },
		],
		health: 120,
		size: 1,
		outputs: true,
	},
	combustionGenerator: {
		name: "Combustion Gen.",
		description: "Burns coal or pyratite for power. Link it to what needs power with Power Nodes.",
		cost: [
			{ resource: "copper", amount: 25 },
			{ resource: "lead", amount: 15 },
		],
		health: 160,
		size: 1,
		generator: { power: 60, fuel: { coal: 1, pyratite: 1.4 }, seconds: 2, storage: 10 },
	},
	solarPanel: {
		name: "Solar Panel",
		description: "A trickle of power from the sun, with no fuel at all.",
		cost: [
			{ resource: "copper", amount: 12 },
			{ resource: "lead", amount: 8 },
		],
		health: 80,
		size: 1,
		generator: { power: 10 },
	},
	rtgGenerator: {
		name: "RTG Generator",
		description: "Slowly decays thorium for a great deal of power.",
		cost: [
			{ resource: "lead", amount: 100 },
			{ resource: "silicon", amount: 75 },
			{ resource: "thorium", amount: 50 },
		],
		health: 600,
		size: 2,
		generator: { power: 270, fuel: { thorium: 1 }, seconds: 14, storage: 10 },
	},
	battery: {
		name: "Battery",
		description: "Stores spare power, and gives it back when the network needs more than it makes.",
		cost: [
			{ resource: "copper", amount: 5 },
			{ resource: "lead", amount: 50 },
		],
		health: 120,
		size: 1,
		battery: 1000,
	},
	largeBattery: {
		name: "Large Battery",
		description: "Stores a great deal of spare power.",
		cost: [
			{ resource: "lead", amount: 50 },
			{ resource: "titanium", amount: 20 },
			{ resource: "silicon", amount: 30 },
		],
		health: 600,
		size: 3,
		battery: 25000,
	},
	powerNode: {
		name: "Power Node",
		description:
			"Carries power between the buildings it links: it links what's in range when placed. Click it, then click a building to link or unlink it.",
		cost: [
			{ resource: "copper", amount: 1 },
			{ resource: "lead", amount: 3 },
		],
		health: 60,
		size: 1,
		range: 48,
		node: 10,
	},
	largePowerNode: {
		name: "Large Node",
		description: "A power node that reaches much further and links more.",
		cost: [
			{ resource: "lead", amount: 10 },
			{ resource: "titanium", amount: 5 },
			{ resource: "silicon", amount: 3 },
		],
		health: 200,
		size: 2,
		range: 120,
		node: 15,
	},
	wall: {
		name: "Wall",
		description: "Blocks aliens. They path round it, or chew through.",
		cost: [{ resource: "copper", amount: 6 }],
		health: 400,
		size: 1,
		wall: true,
	},
	titaniumWall: {
		name: "Ti Wall",
		description: "A wall that takes far longer to chew through.",
		cost: [{ resource: "titanium", amount: 6 }],
		health: 1000,
		size: 1,
		wall: true,
	},
	turret: {
		name: "Turret",
		description:
			"The first line of defence: quick, cheap shots at anything in range, in the air or on the ground. Feed it by belt, or double-click it to load.",
		cost: [
			{ resource: "copper", amount: 25 },
			{ resource: "lead", amount: 15 },
		],
		health: 250,
		size: 1,
		range: 56,
		turret: {
			turn: 300,
			seconds: 0.3,
			maxAmmo: 30,
			projectile: "bullet",
			ammo: {
				copper: { damage: 9, shots: 2 },
				graphite: { damage: 18, shots: 4, rate: 0.8, range: 2 * CELL_STUDS },
				silicon: { damage: 12, shots: 5, rate: 1.5, homing: true },
			},
		},
	},
	autoTurret: {
		name: "Auto-Turret",
		description:
			"Twin barrels that fire very fast, each shot a little lighter than the Turret's. Shreds swarms of small aliens.",
		cost: [
			{ resource: "copper", amount: 35 },
			{ resource: "lead", amount: 25 },
			{ resource: "graphite", amount: 15 },
		],
		health: 300,
		size: 1,
		range: 60,
		turret: {
			turn: 360,
			seconds: 0.12,
			maxAmmo: 40,
			projectile: "bullet",
			ammo: {
				copper: { damage: 7, shots: 2 },
				graphite: { damage: 13, shots: 3, rate: 0.85 },
				silicon: { damage: 9, shots: 4, rate: 1.3, homing: true },
			},
		},
	},
	scorch: {
		name: "Scorch",
		description:
			"A flamethrower that burns coal. Melts anything on the ground up close, every lick of flame scorching all round it, but it can't reach far or hit fliers.",
		cost: [
			{ resource: "copper", amount: 25 },
			{ resource: "graphite", amount: 22 },
		],
		health: 300,
		size: 1,
		range: 28,
		turret: {
			turn: 240,
			seconds: 0.1,
			maxAmmo: 30,
			projectile: "flame",
			speed: 60,
			targets: "ground",
			ammo: {
				coal: { damage: 6, shots: 3, splash: 4 },
				pyratite: { damage: 10, shots: 5, splash: 6 },
			},
		},
	},
	hail: {
		name: "Hail",
		description:
			"Small artillery that lobs shells at the ground from well back. Slow and inaccurate, but cheap, and it outranges early aliens. Can't hit fliers.",
		cost: [
			{ resource: "copper", amount: 40 },
			{ resource: "graphite", amount: 17 },
		],
		health: 260,
		size: 1,
		range: 100,
		turret: {
			turn: 120,
			seconds: 1.2,
			maxAmmo: 10,
			projectile: "shell",
			spread: 4,
			targets: "ground",
			ammo: {
				graphite: { damage: 26, shots: 2, splash: 6 },
				silicon: { damage: 20, shots: 3, splash: 5, rate: 1.2, homing: true },
				pyratite: { damage: 24, shots: 3, splash: 9 },
			},
		},
	},
	scatter: {
		name: "Scatter",
		description:
			"Throws clumps of flak that burst among fliers. Wildly inaccurate, but there's a lot of it. Can't hit the ground.",
		cost: [
			{ resource: "copper", amount: 85 },
			{ resource: "lead", amount: 45 },
		],
		health: 500,
		size: 2,
		range: 80,
		turret: {
			turn: 220,
			seconds: 0.3,
			maxAmmo: 40,
			projectile: "flak",
			volley: 3,
			spread: 10,
			targets: "air",
			ammo: {
				scrap: { damage: 7, shots: 5, splash: 5 },
				lead: { damage: 10, shots: 4, splash: 6 },
				titanium: { damage: 14, shots: 3, splash: 8, rate: 0.9 },
				metaglass: { damage: 9, shots: 5, splash: 7, rate: 1.1 },
			},
		},
	},
	vulcan: {
		name: "Vulcan",
		description: "A gatling that spins up to a blistering rate on one flier at a time. Can't hit the ground.",
		cost: [
			{ resource: "copper", amount: 100 },
			{ resource: "lead", amount: 50 },
			{ resource: "graphite", amount: 40 },
		],
		health: 600,
		size: 2,
		range: 72,
		turret: {
			turn: 200,
			seconds: 0.05,
			maxAmmo: 80,
			projectile: "bullet",
			speed: 220,
			spinUp: 2.5,
			targets: "air",
			ammo: {
				copper: { damage: 6, shots: 3 },
				graphite: { damage: 11, shots: 4, rate: 0.85 },
				silicon: { damage: 8, shots: 5, rate: 1.2, homing: true },
			},
		},
	},
	fuse: {
		name: "Fuse",
		description:
			"A short-range shotgun. Each blast throws a fan of shards that tear through every alien in their path, so crowds melt. Hits fliers and the ground.",
		cost: [
			{ resource: "copper", amount: 90 },
			{ resource: "lead", amount: 40 },
			{ resource: "graphite", amount: 45 },
		],
		health: 800,
		size: 2,
		range: 36,
		turret: {
			turn: 180,
			seconds: 0.6,
			maxAmmo: 20,
			projectile: "bullet",
			speed: 220,
			volley: 3,
			fan: 20,
			ammo: {
				copper: { damage: 24, shots: 4, pierce: 3 },
				thorium: { damage: 40, shots: 5, pierce: 5 },
			},
		},
	},
	salvo: {
		name: "Salvo",
		description:
			"Hammers out heavy rounds on full auto, hitting fliers and the ground alike. A solid all-rounder for the middle of a defence.",
		cost: [
			{ resource: "copper", amount: 100 },
			{ resource: "graphite", amount: 50 },
			{ resource: "titanium", amount: 30 },
		],
		health: 700,
		size: 2,
		range: 76,
		turret: {
			turn: 150,
			seconds: 0.3,
			maxAmmo: 32,
			projectile: "bullet",
			speed: 180,
			ammo: {
				copper: { damage: 13, shots: 2 },
				graphite: { damage: 22, shots: 4, rate: 0.85 },
				silicon: { damage: 17, shots: 5, rate: 1.3, homing: true },
				pyratite: { damage: 18, shots: 4, splash: 4 },
				thorium: { damage: 32, shots: 4 },
			},
		},
	},
	cannon: {
		name: "Cannon",
		description: "Slow, long-range slugs that hit very hard. Can't hit fliers.",
		cost: [
			{ resource: "copper", amount: 75 },
			{ resource: "titanium", amount: 40 },
		],
		health: 1000,
		size: 2,
		range: 150,
		turret: {
			turn: 80,
			seconds: 2.4,
			maxAmmo: 10,
			projectile: "bullet",
			speed: 200,
			targets: "ground",
			rail: true,
			ammo: {
				graphite: { damage: 120, shots: 2, splash: 3 },
				silicon: { damage: 95, shots: 3, splash: 3, homing: true },
				thorium: { damage: 170, shots: 2, pierce: 1 },
			},
		},
	},
	swarmer: {
		name: "Swarmer",
		description: "Looses rockets that curve into their target and blast everything near it.",
		cost: [
			{ resource: "copper", amount: 60 },
			{ resource: "graphite", amount: 35 },
			{ resource: "silicon", amount: 30 },
		],
		health: 700,
		size: 2,
		range: 80,
		turret: {
			turn: 180,
			seconds: 0.35,
			maxAmmo: 30,
			projectile: "rocket",
			ammo: {
				graphite: { damage: 20, shots: 3, splash: 8 },
				silicon: { damage: 16, shots: 5, splash: 7, rate: 1.3 },
				thorium: { damage: 30, shots: 3, splash: 10, rate: 0.8 },
			},
		},
	},
	ripple: {
		name: "Ripple",
		description:
			"Lobs volleys of shells a long way. Slow and inaccurate, but each blasts an area. Can't hit fliers.",
		cost: [
			{ resource: "copper", amount: 150 },
			{ resource: "titanium", amount: 60 },
			{ resource: "silicon", amount: 40 },
		],
		health: 1400,
		size: 3,
		range: 220,
		turret: {
			turn: 60,
			seconds: 4,
			maxAmmo: 20,
			projectile: "shell",
			burst: 3,
			volley: 4,
			spread: 14,
			targets: "ground",
			ammo: {
				graphite: { damage: 40, shots: 2, splash: 10 },
				silicon: { damage: 34, shots: 3, splash: 9, homing: true },
				pyratite: { damage: 36, shots: 3, splash: 13 },
				thorium: { damage: 60, shots: 2, splash: 12, rate: 0.8 },
			},
		},
	},
	reaper: {
		name: "Reaper",
		description:
			"A huge twin-barrelled gun that hammers out heavy rounds at a frightening rate. Tears apart anything, in the air or on the ground, that comes near.",
		cost: [
			{ resource: "copper", amount: 300 },
			{ resource: "graphite", amount: 150 },
			{ resource: "silicon", amount: 120 },
			{ resource: "thorium", amount: 80 },
		],
		health: 2400,
		size: 3,
		range: 104,
		turret: {
			turn: 110,
			seconds: 0.15,
			maxAmmo: 60,
			projectile: "bullet",
			speed: 200,
			ammo: {
				graphite: { damage: 32, shots: 4 },
				silicon: { damage: 26, shots: 5, rate: 1.2, homing: true },
				thorium: { damage: 50, shots: 4, pierce: 1 },
			},
		},
	},
	harbinger: {
		name: "Harbinger",
		description:
			"A colossal rail cannon. From across the map it picks out the toughest alien in range and fires one devastating slug that punches clean through everything behind it.",
		cost: [
			{ resource: "copper", amount: 400 },
			{ resource: "titanium", amount: 200 },
			{ resource: "silicon", amount: 150 },
			{ resource: "thorium", amount: 150 },
		],
		health: 2000,
		size: 3,
		range: 320,
		turret: {
			turn: 35,
			seconds: 5,
			maxAmmo: 8,
			projectile: "bullet",
			speed: 600,
			strongest: true,
			rail: true,
			ammo: {
				titanium: { damage: 380, shots: 1, pierce: 2 },
				thorium: { damage: 600, shots: 1, pierce: 4, range: 40 },
			},
		},
	},
	arc: {
		name: "Arc",
		description:
			"A tesla coil. Runs on power alone: lightning leaps from it to an alien on the ground and on through those near it. Can't hit fliers.",
		cost: [
			{ resource: "copper", amount: 50 },
			{ resource: "lead", amount: 50 },
		],
		health: 260,
		size: 1,
		range: 44,
		power: 200,
		turret: {
			turn: 720,
			seconds: 0.35,
			maxAmmo: 0,
			projectile: "arc",
			targets: "ground",
			ammo: {},
			energy: { damage: 20, chain: 4 },
		},
	},
	meltdown: {
		name: "Meltdown",
		description:
			"A colossal laser. Runs on power alone, a lot of it: it fires a long, sweeping beam that melts every alien along it, in the air or on the ground, then cools down before the next.",
		cost: [
			{ resource: "copper", amount: 450 },
			{ resource: "lead", amount: 300 },
			{ resource: "silicon", amount: 250 },
			{ resource: "metaglass", amount: 80 },
			{ resource: "thorium", amount: 120 },
		],
		health: 2600,
		size: 3,
		range: 112,
		power: 1000,
		turret: {
			turn: 40,
			seconds: 1.5,
			maxAmmo: 0,
			projectile: "laser",
			beam: 3.8,
			ammo: {},
			energy: { damage: 40 },
		},
	},
	mender: {
		name: "Mender",
		description: "Repairs buildings around it. Needs power.",
		cost: [
			{ resource: "copper", amount: 10 },
			{ resource: "lead", amount: 20 },
		],
		health: 180,
		size: 1,
		range: 30,
		repair: 12,
		power: 18,
	},
};

export interface BuildCategory {
	readonly name: string;
	/** Its icon on the build menu's rail (see `glyphs.tsx`). */
	readonly glyph: GlyphId;
	readonly kinds: ReadonlyArray<BuildableKind>;
}

/**
 * The build menu's categories and their buildings, in order. Only buildings a player has researched
 * (or starts with) show, and the Source in a sandbox; a category with none of them hides.
 */
export const BUILD_CATEGORIES: ReadonlyArray<BuildCategory> = [
	{ name: "Production", glyph: "drill", kinds: ["drill", "advancedDrill", "laserDrill"] },
	{
		name: "Distribution",
		glyph: "router",
		kinds: [
			"conveyor",
			"titaniumConveyor",
			"router",
			"sorter",
			"junction",
			"container",
			"vault",
			"unloader",
			"source",
		],
	},
	{
		name: "Crafting",
		glyph: "graphitePress",
		kinds: ["graphitePress", "siliconSmelter", "kiln", "pulverizer", "pyratiteMixer"],
	},
	{
		name: "Power",
		glyph: "powerNode",
		kinds: [
			"combustionGenerator",
			"solarPanel",
			"rtgGenerator",
			"battery",
			"largeBattery",
			"powerNode",
			"largePowerNode",
		],
	},
	{
		name: "Turrets",
		glyph: "turret",
		kinds: [
			"turret",
			"autoTurret",
			"scorch",
			"arc",
			"hail",
			"scatter",
			"vulcan",
			"fuse",
			"salvo",
			"cannon",
			"swarmer",
			"ripple",
			"reaper",
			"harbinger",
			"meltdown",
		],
	},
	{ name: "Defense", glyph: "wall", kinds: ["wall", "titaniumWall", "mender"] },
];

/** Every building a player can place, in build menu order. */
export const BUILDABLE: ReadonlyArray<BuildableKind> = BUILD_CATEGORIES.reduce<Array<BuildableKind>>(
	(all, { kinds }) => [...all, ...kinds],
	[],
);

/** What every player can build before researching anything. */
export const STARTING_BUILDINGS: ReadonlyArray<BuildableKind> = ["drill", "conveyor"];

/** The Tool every character carries for building. The build bar shows while it's out. */
export const BUILD_TOOL = "Build";

/** Share of the cost given back when a building is removed. */
export const REFUND = 0.5;

/** Furthest a player can build or remove from their character, in studs. Building panels open within it too. */
export const BUILD_RANGE = 160;

/** Furthest a player can mine ore, or move items in or out of a building, from their character, in studs. */
export const TRANSFER_RANGE = 24;

/** Seconds between the ores a held click mines, one at a time. */
export const MINE_SECONDS = 0.27;

/** Seconds between drill, crafter and mender ticks. */
export const MACHINE_SECONDS = 2;

/** The most buildings one drag lays. */
export const MAX_LINE = 64;

/** Studs round a drop zone's centre: nothing builds there, and anyone in it when an enemy lands dies. */
export const DROP_ZONE_RADIUS = 72;

/** How far `point` is, across the ground, from the nearest point of the `size`×`size` cells with their -X/-Z corner on `cell`. */
function footprintDistance(cell: number, size: number, point: Vector3): number {
	const centre = cellCenter(cell, size);
	const half = (size * CELL_STUDS) / 2;
	const dx = math.max(math.abs(point.X - centre.X) - half, 0);
	const dz = math.max(math.abs(point.Z - centre.Z) - half, 0);
	return math.sqrt(dx * dx + dz * dz);
}

/** Whether the `size`×`size` cells with their -X/-Z corner on `cell` reach into any of the drop `zones`. */
export function inDropZone(cell: number, size: number, zones: ReadonlyArray<Vector3>): boolean {
	return zones.some((zone) => footprintDistance(cell, size, zone) < DROP_ZONE_RADIUS);
}

/** The drop zone nearest `from`, across the ground. Undefined with no zones. */
export function nearestZone(zones: ReadonlyArray<Vector3>, from: Vector3): Vector3 | undefined {
	let best: Vector3 | undefined;
	let bestDistance = math.huge;
	for (const zone of zones) {
		const distance = new Vector3(zone.X - from.X, 0, zone.Z - from.Z).Magnitude;
		if (distance < bestDistance) [best, bestDistance] = [zone, distance];
	}
	return best;
}

/** Whether `kind` is on the power network: it makes, stores, carries or uses power. Nodes link these. */
export function isPowered(kind: BuildingKind): boolean {
	const def = BUILDINGS[kind];
	return (
		def.power !== undefined || def.generator !== undefined || def.battery !== undefined || def.node !== undefined
	);
}

/** Whether `kind` holds ore an Unloader can take out: the Core or storage. */
export function isStorage(kind: BuildingKind): boolean {
	return kind === "core" || BUILDINGS[kind].store !== undefined;
}

/**
 * Whether a power link between buildings of kinds `a` and `b`, on cells `aCell` and `bCell`, is in
 * range: from a node's centre to the nearest point of the other's footprint. Two nodes link if either reaches.
 */
export function linkReach(a: BuildingKind, aCell: number, b: BuildingKind, bCell: number): boolean {
	const reaches = (from: BuildingKind, fromCell: number, to: BuildingKind, toCell: number) => {
		const def = BUILDINGS[from];
		if (def.node === undefined) return false;
		return footprintDistance(toCell, BUILDINGS[to].size, cellCenter(fromCell, def.size)) <= (def.range ?? 0);
	};
	return reaches(a, aCell, b, bCell) || reaches(b, bCell, a, aCell);
}

/** Whether `kind` is a belt: it carries ore along a path, and joins the belts it meets in runs. */
export function isBelt(kind: BuildingKind): boolean {
	return BUILDINGS[kind].belt !== undefined;
}

/** Belt pieces: any of them can be laid straight over another kind, which is refunded like a removal. */
const LOGISTICS: ReadonlySet<BuildingKind> = new Set(["conveyor", "titaniumConveyor", "router", "sorter", "junction"]);

/**
 * Whether placing `kind` swaps out an `existing` building on its cell instead of being blocked by it.
 * A dragged belt `line` only swaps slower belts, upgrading them, and runs through the rest.
 */
export function replaces(kind: BuildingKind, existing: BuildingKind, line = false): boolean {
	if (kind === existing || !LOGISTICS.has(kind) || !LOGISTICS.has(existing)) return false;
	return !line || (BUILDINGS[existing].belt ?? math.huge) < (BUILDINGS[kind].belt ?? 0);
}
