import type { ResourceId, ResourceStack } from "game/Base/shared/resources";

/*
 * The server keeps the planet's gameplay instances in `Workspace.Base`:
 * - `Base.Buildings`: one Model per building, with attributes `Kind` (BuildingKind),
 *   `Cell` (the -X/-Z corner cell, see map.ts), `Rotation`, `Health` and `MaxHealth`. Drills and
 *   smelters also have `Stored`, turrets `Ammo`, sorters `Filter`, and belts `Entry`, `PathIn`,
 *   `PathMid`, `PathOut` and `PathEnds` (see `BeltPath`).
 * - `Base.Aliens`: one Model per alien, with `Health` and `MaxHealth`.
 * Ore deposits are Models tagged "Ore" (CollectionService), with attributes `Resource` and `Cell`.
 */

export type BuildingKind =
	| "core"
	| "drill"
	| "advancedDrill"
	| "conveyor"
	| "router"
	| "sorter"
	| "junction"
	| "smelter"
	| "wall"
	| "titaniumWall"
	| "turret"
	| "heavyTurret"
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
	 */
	readonly turret?: {
		readonly damage: number;
		readonly seconds: number;
		readonly shots: number;
		readonly magazine: number;
	};
	/** Drills, which must go on ore: mined per tick, and the most they hold. */
	readonly drill?: { readonly yield: number; readonly storage: number };
	/** Smelters: each tick, `amount` of `input` becomes one `output`. They hold up to `storage` of each. */
	readonly craft?: {
		readonly input: ResourceId;
		readonly amount: number;
		readonly output: ResourceId;
		readonly storage: number;
	};
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
	conveyor: {
		name: "Conveyor",
		description: "Carries ore the way it faces. Drag a line; across a belt it lays a Junction.",
		cost: [{ resource: "copper", amount: 2 }],
		health: 45,
		size: 1,
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
		description: "Lets one ore straight through and turns the rest aside. Pick the ore over it.",
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
	smelter: {
		name: "Smelter",
		description: "Presses 2 coal into 1 graphite, the hardest-hitting common ammo.",
		cost: [
			{ resource: "copper", amount: 40 },
			{ resource: "lead", amount: 25 },
		],
		health: 400,
		size: 2,
		craft: { input: "coal", amount: 2, output: "graphite", storage: 20 },
		outputs: true,
	},
	wall: {
		name: "Wall",
		description: "Blocks aliens. They path round it, or chew through.",
		cost: [{ resource: "copper", amount: 6 }],
		health: 400,
		size: 1,
	},
	titaniumWall: {
		name: "Ti Wall",
		description: "A wall that takes far longer to chew through.",
		cost: [{ resource: "titanium", amount: 6 }],
		health: 1000,
		size: 1,
	},
	turret: {
		name: "Turret",
		description: "Shoots aliens in range. Fires ore: feed it by belt, or Load it by hand.",
		cost: [
			{ resource: "copper", amount: 25 },
			{ resource: "lead", amount: 15 },
		],
		health: 250,
		size: 1,
		range: 56,
		turret: { damage: 12, seconds: 0.5, shots: 4, magazine: 12 },
	},
	heavyTurret: {
		name: "Heavy Turret",
		description: "Slow, long-range shots that hit hard. Fires ore, like the Turret.",
		cost: [
			{ resource: "copper", amount: 60 },
			{ resource: "titanium", amount: 30 },
		],
		health: 900,
		size: 2,
		range: 90,
		turret: { damage: 45, seconds: 1.2, shots: 2, magazine: 10 },
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

/** The ores turrets fire, and how hard each hits, times the turret's damage. Coal isn't ammo: smelt it. */
export const AMMO: Partial<Record<ResourceId, number>> = {
	scrap: 0.8,
	copper: 1,
	lead: 1.1,
	titanium: 1.5,
	graphite: 1.8,
	thorium: 2.2,
};

/** The build bar's cards, in order. Only those a player has researched (or starts with) show. */
export const BUILDABLE: ReadonlyArray<BuildableKind> = [
	"drill",
	"advancedDrill",
	"conveyor",
	"router",
	"sorter",
	"junction",
	"smelter",
	"wall",
	"titaniumWall",
	"turret",
	"heavyTurret",
	"mender",
];

/** What every player can build before researching anything. */
export const STARTING_BUILDINGS: ReadonlyArray<BuildableKind> = ["drill", "conveyor"];

/** The Tool every character carries for building. The build bar shows while it's out. */
export const BUILD_TOOL = "Build";

/** Share of the cost given back when a building is removed. */
export const REFUND = 0.5;

/** Furthest a player can build or remove from their character, in studs. */
export const BUILD_RANGE = 160;

/** The most buildings one drag lays. */
export const MAX_LINE = 64;

/** Belt pieces: any of them can be laid straight over another kind, which is refunded like a removal. */
const LOGISTICS: ReadonlySet<BuildingKind> = new Set(["conveyor", "router", "sorter", "junction"]);

/** Whether placing `kind` swaps out an `existing` building on its cell instead of being blocked by it. */
export function replaces(kind: BuildingKind, existing: BuildingKind): boolean {
	return kind !== existing && LOGISTICS.has(kind) && LOGISTICS.has(existing);
}
