import type { ResourceStack } from "game/Base/shared/resources";

/*
 * The server keeps the planet's gameplay instances in `Workspace.Base`:
 * - `Base.Buildings`: one Model per building, with attributes `Kind` (BuildingKind),
 *   `Cell` (the -X/-Z corner cell, see map.ts), `Health` and `MaxHealth`. Drills also have `Stored`.
 * - `Base.Aliens`: one Model per alien, with `Health` and `MaxHealth`.
 * Ore deposits are Models tagged "Ore" (CollectionService), with attributes `Resource` and `Cell`.
 */

export type BuildingKind =
	"core" | "drill" | "advancedDrill" | "wall" | "titaniumWall" | "turret" | "heavyTurret" | "mender";
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
	/** Turrets: damage per shot, and seconds between shots. They shoot within `range`. */
	readonly turret?: { readonly damage: number; readonly seconds: number };
	/** Drills, which must go on ore: mined per tick, and the most they hold. */
	readonly drill?: { readonly yield: number; readonly storage: number };
	/** Health given back per tick to every damaged building within `range`. */
	readonly repair?: number;
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
		description: "Place on ore. Fills up over time; collect it.",
		cost: [{ resource: "copper", amount: 12 }],
		health: 200,
		size: 1,
		drill: { yield: 1, storage: 30 },
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
		description: "Shoots aliens in range.",
		cost: [
			{ resource: "copper", amount: 25 },
			{ resource: "lead", amount: 15 },
		],
		health: 250,
		size: 1,
		range: 56,
		turret: { damage: 12, seconds: 0.5 },
	},
	heavyTurret: {
		name: "Heavy Turret",
		description: "Slow, long-range shots that hit hard.",
		cost: [
			{ resource: "copper", amount: 60 },
			{ resource: "titanium", amount: 30 },
		],
		health: 900,
		size: 2,
		range: 90,
		turret: { damage: 45, seconds: 1.2 },
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

/** The build bar's cards, in order. Only those a player has researched (or starts with) show. */
export const BUILDABLE: ReadonlyArray<BuildableKind> = [
	"drill",
	"advancedDrill",
	"wall",
	"titaniumWall",
	"turret",
	"heavyTurret",
	"mender",
];

/** What every player can build before researching anything. */
export const STARTING_BUILDINGS: ReadonlyArray<BuildableKind> = ["drill"];

/** The Tool every character carries for building. The build bar shows while it's out. */
export const BUILD_TOOL = "Build";

/** Share of the cost given back when a building is removed. */
export const REFUND = 0.5;

/** Furthest a player can build or remove from their character, in studs. */
export const BUILD_RANGE = 160;
