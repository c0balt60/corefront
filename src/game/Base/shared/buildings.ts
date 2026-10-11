import type { ResourceStack } from "game/Base/shared/resources";

/*
 * The server keeps the planet's gameplay instances in `Workspace.Base`:
 * - `Base.Buildings`: one Model per building, with attributes `Kind` (BuildingKind),
 *   `Cell` (the -X/-Z corner cell, see map.ts), `Health` and `MaxHealth`. Drills also have `Stored`.
 * - `Base.Aliens`: one Model per alien, with `Health` and `MaxHealth`.
 * Ore deposits are Models tagged "Ore" (CollectionService), with attributes `Resource` and `Cell`.
 */

export type BuildingKind = "core" | "drill" | "wall" | "turret";
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
	},
	wall: {
		name: "Wall",
		description: "Blocks aliens. They path round it, or chew through.",
		cost: [{ resource: "copper", amount: 6 }],
		health: 400,
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
	},
};

/** The build bar's cards, in order. */
export const BUILDABLE: ReadonlyArray<BuildableKind> = ["drill", "wall", "turret"];

/** The Tool every character carries for building. The build bar shows while it's out. */
export const BUILD_TOOL = "Build";

/** Share of the cost given back when a building is removed. */
export const REFUND = 0.5;

/** Furthest a player can build or remove from their character, in studs. */
export const BUILD_RANGE = 160;
