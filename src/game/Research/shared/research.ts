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

/** The pixel-art icons a node or the build menu can use, drawn by the client (see `glyphs.tsx`). */
export type GlyphId =
	| "core"
	| "lock"
	| "pack"
	| "boots"
	| "bolt"
	| "coils"
	| "shield"
	| "silo"
	| "remove"
	| "drill"
	| "advancedDrill"
	| "laserDrill"
	| "drillBits"
	| "graphitePress"
	| "siliconSmelter"
	| "router"
	| "sorter"
	| "junction"
	| "conveyor"
	| "titaniumConveyor"
	| "source"
	| "wall"
	| "titaniumWall"
	| "plating"
	| "mender"
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
	| "container"
	| "vault"
	| "unloader"
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
	| "arc"
	| "meltdown"
	| "crosshair"
	| "warning";

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
	| "autoTurret"
	| "scatter"
	| "vulcan"
	| "swarmer"
	| "cannon"
	| "ripple"
	| "hail"
	| "scorch"
	| "fuse"
	| "salvo"
	| "reaper"
	| "harbinger"
	| "drillBits"
	| "advancedDrill"
	| "laserDrill"
	| "graphitePress"
	| "siliconSmelter"
	| "router"
	| "sorter"
	| "junction"
	| "titaniumConveyor"
	| "container"
	| "vault"
	| "unloader"
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
	| "arc"
	| "meltdown";

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
		description: "Build menders, which repair buildings around them. They need power.",
		glyph: "mender",
		requires: ["plating", "powerNode"],
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
	autoTurret: {
		name: "Auto-Turret",
		description: "Build auto-turrets: twin barrels that fire very fast.",
		glyph: "autoTurret",
		requires: ["turret"],
		cost: [
			{ resource: "copper", amount: 50 },
			{ resource: "lead", amount: 40 },
			{ resource: "graphite", amount: 20 },
		],
		unlocks: "autoTurret",
		discover: "graphite",
	},
	scatter: {
		name: "Scatter",
		description: "Build scatters: flak that shreds flying aliens, but can't hit the ground.",
		glyph: "scatter",
		requires: ["turret"],
		cost: [
			{ resource: "copper", amount: 60 },
			{ resource: "lead", amount: 45 },
		],
		unlocks: "scatter",
	},
	vulcan: {
		name: "Vulcan",
		description: "Build vulcans: gatlings that spin up to shred one flying alien at a time.",
		glyph: "vulcan",
		requires: ["scatter"],
		cost: [
			{ resource: "copper", amount: 80 },
			{ resource: "lead", amount: 50 },
			{ resource: "graphite", amount: 40 },
		],
		unlocks: "vulcan",
		discover: "graphite",
	},
	swarmer: {
		name: "Swarmer",
		description: "Build swarmers, whose rockets curve into aliens and blast those around them.",
		glyph: "swarmer",
		requires: ["autoTurret"],
		cost: [
			{ resource: "copper", amount: 80 },
			{ resource: "graphite", amount: 50 },
			{ resource: "silicon", amount: 40 },
		],
		unlocks: "swarmer",
		discover: "silicon",
		conquered: 1,
	},
	cannon: {
		name: "Cannon",
		description: "Build cannons: slow, long-range shots that hit very hard.",
		glyph: "cannon",
		requires: ["turret"],
		cost: [
			{ resource: "copper", amount: 80 },
			{ resource: "titanium", amount: 40 },
		],
		unlocks: "cannon",
		discover: "titanium",
		conquered: 1,
	},
	ripple: {
		name: "Ripple",
		description: "Build ripples: artillery that lobs volleys of shells far across the map.",
		glyph: "ripple",
		requires: ["cannon"],
		cost: [
			{ resource: "copper", amount: 150 },
			{ resource: "titanium", amount: 60 },
			{ resource: "silicon", amount: 60 },
		],
		unlocks: "ripple",
		discover: "silicon",
		conquered: 2,
	},
	scorch: {
		name: "Scorch",
		description: "Build scorches: flamethrowers that burn coal to melt ground aliens up close.",
		glyph: "scorch",
		requires: ["turret"],
		cost: [
			{ resource: "copper", amount: 40 },
			{ resource: "graphite", amount: 25 },
		],
		unlocks: "scorch",
		discover: "coal",
	},
	hail: {
		name: "Hail",
		description: "Build hails: small artillery that shells ground aliens from far back.",
		glyph: "hail",
		requires: ["turret"],
		cost: [
			{ resource: "copper", amount: 50 },
			{ resource: "graphite", amount: 25 },
		],
		unlocks: "hail",
		discover: "graphite",
	},
	fuse: {
		name: "Fuse",
		description: "Build fuses: short-range shotguns whose shards tear through crowds.",
		glyph: "fuse",
		requires: ["autoTurret"],
		cost: [
			{ resource: "copper", amount: 100 },
			{ resource: "lead", amount: 50 },
			{ resource: "graphite", amount: 50 },
		],
		unlocks: "fuse",
		conquered: 1,
	},
	salvo: {
		name: "Salvo",
		description: "Build salvos, which fire bursts of heavy rounds at fliers and the ground.",
		glyph: "salvo",
		requires: ["autoTurret"],
		cost: [
			{ resource: "copper", amount: 120 },
			{ resource: "graphite", amount: 60 },
			{ resource: "titanium", amount: 40 },
		],
		unlocks: "salvo",
		discover: "titanium",
		conquered: 1,
	},
	reaper: {
		name: "Reaper",
		description: "Build reapers: huge twin guns that hammer out heavy rounds at a frightening rate.",
		glyph: "reaper",
		requires: ["salvo"],
		cost: [
			{ resource: "copper", amount: 300 },
			{ resource: "graphite", amount: 150 },
			{ resource: "silicon", amount: 120 },
			{ resource: "thorium", amount: 80 },
		],
		unlocks: "reaper",
		discover: "thorium",
		conquered: 3,
	},
	harbinger: {
		name: "Harbinger",
		description: "Build harbingers: rail cannons that snipe the toughest alien from across the map.",
		glyph: "harbinger",
		requires: ["ripple"],
		cost: [
			{ resource: "copper", amount: 400 },
			{ resource: "titanium", amount: 200 },
			{ resource: "silicon", amount: 150 },
			{ resource: "thorium", amount: 150 },
		],
		unlocks: "harbinger",
		discover: "thorium",
		conquered: 3,
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
	laserDrill: {
		name: "Laser Drill",
		description: "Build laser drills: 2×2, mining fast from every cell of ore under them.",
		glyph: "laserDrill",
		requires: ["advancedDrill", "powerNode"],
		cost: [
			{ resource: "copper", amount: 80 },
			{ resource: "graphite", amount: 40 },
			{ resource: "silicon", amount: 30 },
		],
		unlocks: "laserDrill",
		discover: "silicon",
	},
	graphitePress: {
		name: "Graphite Press",
		description: "Build graphite presses, which press coal into graphite: the hardest-hitting common ammo.",
		glyph: "graphitePress",
		requires: ["drillBits"],
		cost: [
			{ resource: "copper", amount: 40 },
			{ resource: "lead", amount: 25 },
		],
		unlocks: "graphitePress",
		discover: "coal",
	},
	siliconSmelter: {
		name: "Silicon Smelter",
		description: "Build silicon smelters, which smelt sand, coal and lead into silicon. They need power.",
		glyph: "siliconSmelter",
		requires: ["graphitePress", "powerNode"],
		cost: [
			{ resource: "copper", amount: 60 },
			{ resource: "lead", amount: 40 },
			{ resource: "graphite", amount: 20 },
		],
		unlocks: "siliconSmelter",
		discover: "sand",
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
	titaniumConveyor: {
		name: "Titanium Conveyor",
		description: "Build faster belts. Lay them over conveyors to upgrade them.",
		glyph: "titaniumConveyor",
		requires: ["router"],
		cost: [
			{ resource: "copper", amount: 30 },
			{ resource: "titanium", amount: 20 },
		],
		unlocks: "titaniumConveyor",
		discover: "titanium",
	},
	container: {
		name: "Container",
		description: "Build containers, which store ore off the belts until Unloaders take it out.",
		glyph: "container",
		requires: ["router"],
		cost: [
			{ resource: "copper", amount: 40 },
			{ resource: "lead", amount: 40 },
		],
		unlocks: "container",
	},
	vault: {
		name: "Vault",
		description: "Build vaults: huge storage for ore.",
		glyph: "vault",
		requires: ["container"],
		cost: [
			{ resource: "titanium", amount: 120 },
			{ resource: "thorium", amount: 60 },
		],
		unlocks: "vault",
		discover: "thorium",
	},
	unloader: {
		name: "Unloader",
		description: "Build unloaders, which take ore out of storage or the Core for the buildings beside them.",
		glyph: "unloader",
		requires: ["container"],
		cost: [
			{ resource: "copper", amount: 30 },
			{ resource: "graphite", amount: 20 },
		],
		unlocks: "unloader",
		discover: "graphite",
	},
	kiln: {
		name: "Kiln",
		description: "Build kilns, which fire lead and sand into metaglass. They need power.",
		glyph: "kiln",
		requires: ["graphitePress", "powerNode"],
		cost: [
			{ resource: "copper", amount: 60 },
			{ resource: "lead", amount: 30 },
			{ resource: "graphite", amount: 30 },
		],
		unlocks: "kiln",
		discover: "sand",
	},
	pulverizer: {
		name: "Pulverizer",
		description: "Build pulverizers, which grind scrap into sand. They need power.",
		glyph: "pulverizer",
		requires: ["graphitePress", "powerNode"],
		cost: [
			{ resource: "copper", amount: 30 },
			{ resource: "lead", amount: 25 },
		],
		unlocks: "pulverizer",
		discover: "scrap",
	},
	pyratiteMixer: {
		name: "Pyratite Mixer",
		description: "Build pyratite mixers, which mix coal, lead and sand into pyratite. They need power.",
		glyph: "pyratiteMixer",
		requires: ["siliconSmelter"],
		cost: [
			{ resource: "copper", amount: 50 },
			{ resource: "lead", amount: 30 },
		],
		unlocks: "pyratiteMixer",
		discover: "sand",
	},
	combustionGenerator: {
		name: "Combustion Generator",
		description: "Build combustion generators, which burn coal or pyratite for power.",
		glyph: "combustionGenerator",
		side: "up",
		requires: [],
		cost: [
			{ resource: "copper", amount: 30 },
			{ resource: "lead", amount: 20 },
		],
		unlocks: "combustionGenerator",
		discover: "coal",
	},
	powerNode: {
		name: "Power Node",
		description: "Build power nodes, which carry power from generators to what needs it.",
		glyph: "powerNode",
		requires: ["combustionGenerator"],
		cost: [
			{ resource: "copper", amount: 15 },
			{ resource: "lead", amount: 20 },
		],
		unlocks: "powerNode",
	},
	solarPanel: {
		name: "Solar Panel",
		description: "Build solar panels: a trickle of power with no fuel.",
		glyph: "solarPanel",
		requires: ["powerNode"],
		cost: [
			{ resource: "copper", amount: 20 },
			{ resource: "lead", amount: 20 },
		],
		unlocks: "solarPanel",
	},
	battery: {
		name: "Battery",
		description: "Build batteries, which store spare power for when it's needed.",
		glyph: "battery",
		requires: ["powerNode"],
		cost: [
			{ resource: "copper", amount: 15 },
			{ resource: "lead", amount: 40 },
		],
		unlocks: "battery",
	},
	largeBattery: {
		name: "Large Battery",
		description: "Build large batteries, which store a great deal of power.",
		glyph: "largeBattery",
		requires: ["battery"],
		cost: [
			{ resource: "lead", amount: 60 },
			{ resource: "titanium", amount: 30 },
			{ resource: "silicon", amount: 30 },
		],
		unlocks: "largeBattery",
		discover: "titanium",
	},
	largePowerNode: {
		name: "Large Node",
		description: "Build large nodes, which carry power much further.",
		glyph: "largePowerNode",
		requires: ["powerNode"],
		cost: [
			{ resource: "lead", amount: 40 },
			{ resource: "titanium", amount: 20 },
			{ resource: "silicon", amount: 15 },
		],
		unlocks: "largePowerNode",
		discover: "titanium",
	},
	rtgGenerator: {
		name: "RTG Generator",
		description: "Build RTG generators, which slowly decay thorium for a great deal of power.",
		glyph: "rtgGenerator",
		requires: ["combustionGenerator"],
		cost: [
			{ resource: "lead", amount: 120 },
			{ resource: "silicon", amount: 80 },
			{ resource: "thorium", amount: 60 },
		],
		unlocks: "rtgGenerator",
		discover: "thorium",
		conquered: 2,
	},
	arc: {
		name: "Arc",
		description: "Build arcs: tesla coils that run on power, their lightning leaping between ground aliens.",
		glyph: "arc",
		requires: ["turret", "powerNode"],
		cost: [
			{ resource: "copper", amount: 50 },
			{ resource: "lead", amount: 50 },
		],
		unlocks: "arc",
	},
	meltdown: {
		name: "Meltdown",
		description:
			"Build meltdowns: colossal lasers that melt every alien along their beam. They need a lot of power.",
		glyph: "meltdown",
		requires: ["arc"],
		cost: [
			{ resource: "copper", amount: 500 },
			{ resource: "lead", amount: 300 },
			{ resource: "silicon", amount: 250 },
			{ resource: "metaglass", amount: 80 },
			{ resource: "thorium", amount: 150 },
		],
		unlocks: "meltdown",
		discover: "thorium",
		conquered: 3,
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
	"laserDrill",
	"graphitePress",
	"siliconSmelter",
	"pyratiteMixer",
	"kiln",
	"pulverizer",
	"router",
	"sorter",
	"junction",
	"titaniumConveyor",
	"container",
	"vault",
	"unloader",
	"combustionGenerator",
	"powerNode",
	"solarPanel",
	"battery",
	"largeBattery",
	"largePowerNode",
	"rtgGenerator",
	"wall",
	"plating",
	"mender",
	"titaniumWall",
	"turret",
	"hardenedRounds",
	"scorch",
	"arc",
	"meltdown",
	"hail",
	"autoTurret",
	"fuse",
	"salvo",
	"reaper",
	"swarmer",
	"scatter",
	"vulcan",
	"cannon",
	"ripple",
	"harbinger",
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

/** Whether `levels` let a player place `kind`. The Source is only ever a `sandbox`'s. */
export function canBuild(levels: Levels, kind: BuildableKind, sandbox = false): boolean {
	if (kind === "source") return sandbox;
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
