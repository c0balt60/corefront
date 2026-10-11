import type { ResourceId, ResourceStack } from "game/Base/shared/resources";
import type { GlyphId } from "game/Research/shared/research";

/*
 * The server keeps the planet's gameplay instances in `Workspace.Base`:
 * - `Base.Buildings`: one Model per building, with attributes `Kind` (BuildingKind),
 *   `Cell` (the -X/-Z corner cell, see map.ts), `Rotation`, `Health` and `MaxHealth`. Drills and
 *   crafters also have `Resource` (what they make) and `Stored`, drills `Yield` (per tick), crafters
 *   `Input_<resource>` for each input, turrets `Ammo`, sorters and sources `Filter`, and belts `Entry`, `PathIn`,
 *   `PathMid`, `PathOut` and `PathEnds` (see `BeltPath`).
 * - `Base.Aliens`: one Model per alien, with `Health` and `MaxHealth`.
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
	| "graphitePress"
	| "siliconSmelter"
	| "wall"
	| "titaniumWall"
	| "turret"
	| "autoTurret"
	| "cannon"
	| "swarmer"
	| "ripple"
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
	/**
	 * Turrets: damage per shot, and seconds between shots. They shoot within `range`, firing ore
	 * (see `AMMO`): each item loaded is `shots` shots, and they hold up to `magazine` items.
	 * With a `burst`, they fire that many shots in quick succession, and `seconds` is the reload
	 * after each burst. Without a `projectile` a shot hits at once; rockets curve into their target
	 * and shells arc down near it, `volley` at a time, landing up to `spread` studs off. Either
	 * hurts every alien within `splash` studs of where it lands.
	 */
	readonly turret?: {
		readonly damage: number;
		readonly seconds: number;
		readonly shots: number;
		readonly magazine: number;
		readonly burst?: number;
		readonly projectile?: "rocket" | "shell";
		readonly volley?: number;
		readonly spread?: number;
		readonly splash?: number;
	};
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
		description: "Place over ore. Mines fast from every cell of ore under it.",
		cost: [
			{ resource: "copper", amount: 40 },
			{ resource: "graphite", amount: 30 },
			{ resource: "silicon", amount: 20 },
		],
		health: 500,
		size: 2,
		drill: { yield: 3, storage: 120 },
		outputs: true,
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
		description: "Smelts 2 sand, 1 coal and 1 lead into 1 silicon.",
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
		description: "Shoots aliens in range, quickly. Fires ore: feed it by belt, or double-click it to load.",
		cost: [
			{ resource: "copper", amount: 25 },
			{ resource: "lead", amount: 15 },
		],
		health: 250,
		size: 1,
		range: 56,
		turret: { damage: 9, seconds: 0.3, shots: 6, magazine: 12 },
	},
	autoTurret: {
		name: "Auto-Turret",
		description: "Twin barrels that fire very fast, each shot a little lighter than the Turret's.",
		cost: [
			{ resource: "copper", amount: 35 },
			{ resource: "lead", amount: 25 },
			{ resource: "graphite", amount: 15 },
		],
		health: 300,
		size: 1,
		range: 60,
		turret: { damage: 7, seconds: 0.12, shots: 10, magazine: 20 },
	},
	cannon: {
		name: "Cannon",
		description: "Slow, long-range shots that hit very hard. Fires ore, like the Turret.",
		cost: [
			{ resource: "copper", amount: 75 },
			{ resource: "titanium", amount: 40 },
		],
		health: 1000,
		size: 2,
		range: 100,
		turret: { damage: 130, seconds: 2.4, shots: 2, magazine: 8 },
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
		turret: { damage: 20, seconds: 0.35, shots: 4, magazine: 16, projectile: "rocket", splash: 8 },
	},
	ripple: {
		name: "Ripple",
		description: "Lobs bursts of shell volleys a long way. Slow to reload and inaccurate, but each blasts an area.",
		cost: [
			{ resource: "copper", amount: 150 },
			{ resource: "titanium", amount: 60 },
			{ resource: "silicon", amount: 40 },
		],
		health: 1400,
		size: 3,
		range: 220,
		turret: {
			damage: 40,
			seconds: 4,
			shots: 1,
			magazine: 12,
			burst: 3,
			projectile: "shell",
			volley: 4,
			spread: 14,
			splash: 10,
		},
	},
	mender: {
		name: "Mender",
		description: "Repairs buildings around it.",
		cost: [
			{ resource: "copper", amount: 10 },
			{ resource: "lead", amount: 20 },
		],
		health: 180,
		size: 1,
		range: 30,
		repair: 12,
	},
};

/** The ores turrets fire, and how hard each hits, times the turret's damage. Coal isn't ammo: press it. */
export const AMMO: Partial<Record<ResourceId, number>> = {
	scrap: 0.8,
	copper: 1,
	lead: 1.1,
	titanium: 1.5,
	graphite: 1.8,
	thorium: 2.2,
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
		kinds: ["conveyor", "titaniumConveyor", "router", "sorter", "junction", "source"],
	},
	{ name: "Crafting", glyph: "graphitePress", kinds: ["graphitePress", "siliconSmelter"] },
	{ name: "Turrets", glyph: "turret", kinds: ["turret", "autoTurret", "cannon", "swarmer", "ripple"] },
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
