import { type BuildableKind, STARTING_BUILDINGS } from "game/Base/shared/buildings";
import { type ResourceId, RESOURCES, type ResourceStack } from "game/Base/shared/resources";

/*
 * The research tree. Each player researches their own copy, paying from the
 * team's Core pool, and keeps it for the life of the world server. To add an
 * upgrade: add a stat (if it's new) and read it where it applies with
 * `statValue`; then add a node id, its entry in `RESEARCH` and its place in
 * `RESEARCH_ORDER`. To add a building to research: give its node `unlocks`.
 * The tree draws itself from `requires`; new art goes in `glyphs.tsx` or `image`.
 */

/** The pixel-art icons a node can use, drawn by the client (see `glyphs.tsx`). */
export type GlyphId =
	| "core"
	| "lock"
	| "pack"
	| "boots"
	| "bolt"
	| "coils"
	| "shield"
	| "silo"
	| "drill"
	| "advancedDrill"
	| "drillBits"
	| "smelter"
	| "router"
	| "sorter"
	| "junction"
	| "wall"
	| "titaniumWall"
	| "plating"
	| "mender"
	| "turret"
	| "heavyTurret"
	| "crosshair";

export type StatId =
	| "carryCapacity"
	| "walkSpeed"
	| "blasterDamage"
	| "blasterCooldown"
	| "coreHealth"
	| "coreCapacity"
	| "buildingHealth"
	| "turretDamage"
	| "drillYield";

export interface StatDef {
	readonly name: string;
	/** The value before any research. Nodes add `step` per level on top. */
	readonly base: number;
	/** Shown as a percentage: a multiplier, where 1 is 100%. */
	readonly percent?: true;
	/**
	 * The team's, not each player's: researched once, for everyone. The Core's
	 * stats are, since there's one Core. Buildings use their placer's stats.
	 */
	readonly team?: true;
}

export const STATS: Record<StatId, StatDef> = {
	carryCapacity: { name: "Carry capacity", base: 50 },
	walkSpeed: { name: "Walk speed", base: 30 },
	blasterDamage: { name: "Blaster damage", base: 15 },
	blasterCooldown: { name: "Seconds between shots", base: 0.25 },
	coreHealth: { name: "Core health", base: 1500, team: true },
	coreCapacity: { name: "Core storage per resource", base: 400, team: true },
	buildingHealth: { name: "Building health", base: 1, percent: true },
	turretDamage: { name: "Turret damage", base: 1, percent: true },
	drillYield: { name: "Extra ore per drill tick", base: 0 },
};

export type ResearchId =
	| "cargoPack"
	| "servoBoots"
	| "blasterCells"
	| "rapidCoils"
	| "coreArmor"
	| "coreSilos"
	| "wall"
	| "plating"
	| "titaniumWall"
	| "mender"
	| "turret"
	| "hardenedRounds"
	| "heavyTurret"
	| "drillBits"
	| "advancedDrill"
	| "smelter"
	| "router"
	| "sorter"
	| "junction";

export interface ResearchNode {
	readonly name: string;
	readonly description: string;
	/** Its icon in the tree. */
	readonly glyph: GlyphId;
	/** An uploaded icon (rbxassetid://...) to show instead of the glyph. */
	readonly image?: string;
	/** Roots only: which side of the Core their branch grows. Buildings go up, the rest down. */
	readonly side?: "up" | "down";
	/** Nodes researched at least once before this one. The first is its parent in the tree. */
	readonly requires: ReadonlyArray<ResearchId>;
	/** The first level's cost. Each level after costs `COST_GROWTH` times the last. */
	readonly cost: ReadonlyArray<ResourceStack>;
	/** How many times it can be researched. 1 when left out. */
	readonly levels?: number;
	/** What each level adds to a stat. */
	readonly effect?: { readonly stat: StatId; readonly step: number };
	/** The building it lets its researcher place. */
	readonly unlocks?: BuildableKind;
	/** Hidden behind "Find ..." until the team has had this resource in the Core. */
	readonly discover?: ResourceId;
	/** How many planets the team must have liberated first. */
	readonly conquered?: number;
}

export const COST_GROWTH = 1.75;

export const RESEARCH: Record<ResearchId, ResearchNode> = {
	cargoPack: {
		name: "Cargo Pack",
		description: "Carry more ore between trips to the Core.",
		glyph: "pack",
		side: "down",
		requires: [],
		cost: [{ resource: "copper", amount: 25 }],
		levels: 3,
		effect: { stat: "carryCapacity", step: 25 },
	},
	servoBoots: {
		name: "Servo Boots",
		description: "Run faster.",
		glyph: "boots",
		requires: ["cargoPack"],
		cost: [
			{ resource: "copper", amount: 20 },
			{ resource: "lead", amount: 15 },
		],
		levels: 3,
		effect: { stat: "walkSpeed", step: 4 },
	},
	blasterCells: {
		name: "Overcharged Cells",
		description: "Your Blaster hits harder.",
		glyph: "bolt",
		side: "down",
		requires: [],
		cost: [
			{ resource: "copper", amount: 20 },
			{ resource: "lead", amount: 10 },
		],
		levels: 4,
		effect: { stat: "blasterDamage", step: 5 },
	},
	rapidCoils: {
		name: "Rapid Coils",
		description: "Your Blaster fires faster.",
		glyph: "coils",
		requires: ["blasterCells"],
		cost: [
			{ resource: "copper", amount: 25 },
			{ resource: "lead", amount: 25 },
		],
		levels: 3,
		effect: { stat: "blasterCooldown", step: -0.03 },
	},
	coreArmor: {
		name: "Core Plating",
		description: "The Core takes more punishment. Researched for the whole team.",
		glyph: "shield",
		side: "down",
		requires: [],
		cost: [
			{ resource: "copper", amount: 60 },
			{ resource: "lead", amount: 40 },
		],
		levels: 3,
		effect: { stat: "coreHealth", step: 500 },
	},
	coreSilos: {
		name: "Core Silos",
		description: "The Core stores more of each resource. Researched for the whole team.",
		glyph: "silo",
		side: "down",
		requires: [],
		cost: [
			{ resource: "copper", amount: 40 },
			{ resource: "lead", amount: 30 },
		],
		levels: 4,
		effect: { stat: "coreCapacity", step: 250 },
	},
	wall: {
		name: "Wall",
		description: "Build walls to steer and stall the aliens.",
		glyph: "wall",
		side: "up",
		requires: [],
		cost: [{ resource: "copper", amount: 10 }],
		unlocks: "wall",
	},
	plating: {
		name: "Reinforced Plating",
		description: "Buildings you place have more health.",
		glyph: "plating",
		requires: ["wall"],
		cost: [
			{ resource: "copper", amount: 30 },
			{ resource: "lead", amount: 20 },
		],
		levels: 3,
		effect: { stat: "buildingHealth", step: 0.2 },
	},
	titaniumWall: {
		name: "Titanium Wall",
		description: "Build walls that last far longer.",
		glyph: "titaniumWall",
		requires: ["wall"],
		cost: [
			{ resource: "copper", amount: 20 },
			{ resource: "titanium", amount: 20 },
		],
		unlocks: "titaniumWall",
		discover: "titanium",
	},
	mender: {
		name: "Mender",
		description: "Build menders, which repair buildings around them.",
		glyph: "mender",
		requires: ["plating"],
		cost: [
			{ resource: "copper", amount: 20 },
			{ resource: "lead", amount: 40 },
		],
		unlocks: "mender",
		conquered: 1,
	},
	turret: {
		name: "Turret",
		description: "Build turrets that shoot aliens in range.",
		glyph: "turret",
		side: "up",
		requires: [],
		cost: [
			{ resource: "copper", amount: 20 },
			{ resource: "lead", amount: 10 },
		],
		unlocks: "turret",
	},
	hardenedRounds: {
		name: "Hardened Rounds",
		description: "Turrets you place hit harder.",
		glyph: "crosshair",
		requires: ["turret"],
		cost: [
			{ resource: "copper", amount: 40 },
			{ resource: "lead", amount: 30 },
		],
		levels: 3,
		effect: { stat: "turretDamage", step: 0.2 },
	},
	heavyTurret: {
		name: "Heavy Turret",
		description: "Build heavy turrets: slow, long-range and hard-hitting.",
		glyph: "heavyTurret",
		requires: ["turret"],
		cost: [
			{ resource: "copper", amount: 80 },
			{ resource: "titanium", amount: 40 },
		],
		unlocks: "heavyTurret",
		discover: "titanium",
		conquered: 1,
	},
	drillBits: {
		name: "Drill Bits",
		description: "Drills you place mine more each tick.",
		glyph: "drillBits",
		side: "up",
		requires: [],
		cost: [
			{ resource: "copper", amount: 30 },
			{ resource: "lead", amount: 10 },
		],
		levels: 2,
		effect: { stat: "drillYield", step: 1 },
	},
	advancedDrill: {
		name: "Advanced Drill",
		description: "Build advanced drills, which mine faster and hold more.",
		glyph: "advancedDrill",
		requires: ["drillBits"],
		cost: [
			{ resource: "copper", amount: 40 },
			{ resource: "lead", amount: 25 },
		],
		unlocks: "advancedDrill",
		conquered: 1,
	},
	smelter: {
		name: "Smelter",
		description: "Build smelters, which press coal into graphite: the hardest-hitting common ammo.",
		glyph: "smelter",
		requires: ["drillBits"],
		cost: [
			{ resource: "copper", amount: 40 },
			{ resource: "lead", amount: 25 },
		],
		unlocks: "smelter",
		discover: "coal",
	},
	router: {
		name: "Router",
		description: "Build routers, which pass ore from belts on to every side.",
		glyph: "router",
		side: "up",
		requires: [],
		cost: [{ resource: "copper", amount: 15 }],
		unlocks: "router",
	},
	sorter: {
		name: "Sorter",
		description: "Build sorters, which let one ore through and turn the rest aside.",
		glyph: "sorter",
		requires: ["router"],
		cost: [
			{ resource: "copper", amount: 25 },
			{ resource: "lead", amount: 15 },
		],
		unlocks: "sorter",
	},
	junction: {
		name: "Junction",
		description: "Build junctions, which let two belt lines cross.",
		glyph: "junction",
		requires: ["router"],
		cost: [
			{ resource: "copper", amount: 20 },
			{ resource: "lead", amount: 10 },
		],
		unlocks: "junction",
	},
};

/** Every node, in the order the tree lays out siblings left to right, roots on each side of the Core likewise. */
export const RESEARCH_ORDER: ReadonlyArray<ResearchId> = [
	"cargoPack",
	"servoBoots",
	"blasterCells",
	"rapidCoils",
	"coreArmor",
	"coreSilos",
	"drillBits",
	"advancedDrill",
	"smelter",
	"router",
	"sorter",
	"junction",
	"wall",
	"plating",
	"mender",
	"titaniumWall",
	"turret",
	"hardenedRounds",
	"heavyTurret",
];

// A node missing from the order would never be drawn, so catch it on load.
for (const [id] of pairs(RESEARCH)) assert(RESEARCH_ORDER.includes(id), `RESEARCH_ORDER is missing "${id}"`);

/** How many times each node has been researched. A missing node is 0. */
export type Levels = Partial<Record<ResearchId, number>>;

/** What the team has done, which some nodes wait on. */
export interface ResearchGates {
	/** How many planets are liberated. */
	readonly conquered: number;
	/** Every resource the Core has held. */
	readonly discovered: ReadonlyArray<ResourceId>;
}

export function maxLevel(id: ResearchId): number {
	return RESEARCH[id].levels ?? 1;
}

/** Whether `id` is researched once for the whole team rather than per player. */
export function isTeamNode(id: ResearchId): boolean {
	const effect = RESEARCH[id].effect;
	return effect !== undefined && STATS[effect.stat].team === true;
}

/** What researching `id` again costs, when it is at `level` now. */
export function levelCost(id: ResearchId, level: number): Array<ResourceStack> {
	return RESEARCH[id].cost.map(({ resource, amount }) => ({
		resource,
		amount: math.ceil(amount * COST_GROWTH ** level),
	}));
}

/** A stat's value with `levels` researched. */
export function statValue(levels: Levels, stat: StatId): number {
	let value = STATS[stat].base;
	for (const id of RESEARCH_ORDER) {
		const effect = RESEARCH[id].effect;
		if (effect?.stat === stat) value += effect.step * (levels[id] ?? 0);
	}
	return value;
}

/** Whether `levels` let a player place `kind`. */
export function canBuild(levels: Levels, kind: BuildableKind): boolean {
	if (STARTING_BUILDINGS.includes(kind)) return true;
	return RESEARCH_ORDER.some((id) => RESEARCH[id].unlocks === kind && (levels[id] ?? 0) > 0);
}

/** Why `id` can't be researched (again) yet, cost aside, or undefined when it can. */
export function lockReason(id: ResearchId, levels: Levels, gates: ResearchGates): string | undefined {
	const node = RESEARCH[id];
	if ((levels[id] ?? 0) >= maxLevel(id)) return "Fully researched";
	const missing = node.requires.find((required) => (levels[required] ?? 0) === 0);
	if (missing !== undefined) return `Requires ${RESEARCH[missing].name}`;
	if (node.discover !== undefined && !gates.discovered.includes(node.discover)) {
		return `Find ${RESOURCES[node.discover].name}`;
	}
	const conquered = node.conquered ?? 0;
	if (conquered > gates.conquered) return `Liberate ${conquered} planet${conquered === 1 ? "" : "s"}`;
	return undefined;
}

/** A stat's value as the tree shows it: "+40%", "2.5", "1500". */
export function formatStat(stat: StatId, value: number): string {
	if (STATS[stat].percent) return `${math.round(value * 100)}%`;
	return tostring(math.round(value * 100) / 100);
}
