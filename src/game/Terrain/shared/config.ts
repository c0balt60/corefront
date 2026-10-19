import type { Mission, Planet, PlanetKind } from "core/Worlds/shared/star-system";

/** The map shapes `layoutFor` can build (see layout.ts). */
export const ARCHETYPES = ["plains", "corridor", "crater", "split", "islands", "canyons"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

/**
 * One tunable terrain setting. `TERRAIN_FIELDS` is the single schema: it gives
 * the defaults, drives server-side sanitizing and builds the debug panel.
 */
export type ConfigField =
	| {
			readonly kind: "number";
			readonly group: string;
			readonly key: string;
			readonly label: string;
			readonly default: number;
			readonly min: number;
			readonly max: number;
			readonly step: number;
	  }
	| {
			readonly kind: "choice";
			readonly group: string;
			readonly key: string;
			readonly label: string;
			readonly default: string;
			readonly options: ReadonlyArray<string>;
	  };

type NumberField = Extract<ConfigField, { kind: "number" }>;

/** Every terrain setting, keyed like `TERRAIN_FIELDS`. Distances and heights are studs. */
export interface TerrainConfig {
	readonly seed: number;
	/** Picks the biome set, the fluid and the props (see biomes.ts). */
	readonly kind: PlanetKind;
	readonly edgeHeight: number;

	/** The map shape; "auto" picks one from the seed and the kind. */
	readonly archetype: Archetype | "auto";
	/** The share of the full map that is playable; the rest is cliff. */
	readonly mapScale: number;
	/** 0-4, see `LEVEL_NAMES`. With the mission it sets how many drop zones or enemy bases there are. */
	readonly difficulty: number;
	readonly mission: Mission;
	/** How high the layout's cliff walls rise, in studs. */
	readonly wallHeight: number;

	readonly seaLevel: number;
	readonly landHeight: number;
	readonly detailScale: number;
	readonly detailStrength: number;
	readonly hillHeight: number;
	readonly hillScale: number;
	readonly reliefScale: number;
	readonly erosion: number;

	readonly rangeScale: number;
	readonly rangeWidth: number;
	readonly mountainBase: number;
	readonly mountainHeight: number;
	readonly mountainScale: number;

	readonly biomeScale: number;
	readonly biomeBlend: number;
	readonly slopeElevation: number;
	readonly peakElevation: number;
	readonly temperatureBias: number;
	readonly moistureBias: number;

	readonly riverScale: number;
	readonly riverWidth: number;
	readonly riverDepth: number;
	readonly riverMaxElevation: number;
	readonly lakeAmount: number;
	readonly lakeScale: number;

	readonly beachHeight: number;
	readonly snowLine: number;
	readonly steepSlope: number;

	readonly propDensity: number;
	readonly oreDensity: number;
}

function number(
	group: string,
	key: keyof TerrainConfig,
	label: string,
	value: number,
	min: number,
	max: number,
	step: number,
): ConfigField {
	return { kind: "number", group, key, label, default: value, min, max, step };
}

/** Panel sections, in order. Every field's `group` is one of these. */
export const TERRAIN_GROUPS: ReadonlyArray<string> = [
	"World",
	"Layout",
	"Shape",
	"Mountains",
	"Biomes",
	"Water",
	"Materials",
	"Assets",
];

// Scaled down from terrain-generator's open world to a 1536-stud map.
export const TERRAIN_FIELDS: ReadonlyArray<ConfigField> = [
	number("World", "seed", "Seed", 1337, 0, 2147483646, 1),
	{
		kind: "choice",
		group: "World",
		key: "kind",
		label: "Planet kind",
		default: "Habitable",
		options: ["Habitable", "Barren", "Frozen", "Volcanic"],
	},
	number("World", "edgeHeight", "Edge cliff height", 140, 0, 300, 1),

	{
		kind: "choice",
		group: "Layout",
		key: "archetype",
		label: "Map shape",
		default: "auto",
		options: ["auto", ...ARCHETYPES],
	},
	number("Layout", "mapScale", "Playable share of the map", 1, 0.5, 1, 0.01),
	number("Layout", "difficulty", "Difficulty", 2, 0, 4, 1),
	{
		kind: "choice",
		group: "Layout",
		key: "mission",
		label: "Mission",
		default: "defend",
		options: ["defend", "attack"],
	},
	number("Layout", "wallHeight", "Cliff wall height", 90, 40, 200, 1),

	// Sea level is also the lava level and the frozen lakes' ice level. Keep it on the 4-stud voxel grid.
	number("Shape", "seaLevel", "Sea level", 0, -16, 64, 4),
	number("Shape", "landHeight", "Land height", 10, 0, 60, 1),
	number("Shape", "detailScale", "Detail scale", 160, 32, 600, 1),
	number("Shape", "detailStrength", "Detail strength", 1, 0, 3, 0.05),
	number("Shape", "hillHeight", "Hill height", 30, 0, 120, 1),
	number("Shape", "hillScale", "Hill scale", 400, 100, 2000, 10),
	number("Shape", "reliefScale", "Hills vs plains scale", 900, 200, 4000, 10),
	number("Shape", "erosion", "Erosion", 0.15, 0, 1, 0.01),

	number("Mountains", "rangeScale", "Range spacing", 1200, 300, 4000, 10),
	number("Mountains", "rangeWidth", "Range width (studs)", 260, 50, 1000, 5),
	number("Mountains", "mountainBase", "Range uplift", 40, 0, 160, 1),
	number("Mountains", "mountainHeight", "Peak height", 120, 0, 300, 1),
	number("Mountains", "mountainScale", "Peak scale", 420, 100, 2000, 10),

	number("Biomes", "biomeScale", "Climate scale", 500, 100, 3000, 10),
	number("Biomes", "biomeBlend", "Blend width", 0.08, 0.02, 0.15, 0.01),
	number("Biomes", "slopeElevation", "Slopes start", 60, 30, 200, 1),
	number("Biomes", "peakElevation", "Peaks start", 110, 60, 300, 1),
	number("Biomes", "temperatureBias", "Temperature bias", 0, -0.6, 0.6, 0.01),
	number("Biomes", "moistureBias", "Moisture bias", 0, -0.6, 0.6, 0.01),

	number("Water", "riverScale", "River scale", 700, 200, 3000, 10),
	number("Water", "riverWidth", "River width", 0.035, 0, 0.15, 0.001),
	number("Water", "riverDepth", "River and lake depth", 8, 0, 32, 1),
	number("Water", "riverMaxElevation", "River max elevation", 50, 0, 200, 1),
	number("Water", "lakeAmount", "Lake amount", 0.35, 0, 1, 0.01),
	number("Water", "lakeScale", "Lake scale", 260, 80, 1000, 10),

	number("Materials", "beachHeight", "Beach height", 3, 0, 12, 1),
	number("Materials", "snowLine", "Snow line (temperate)", 130, 40, 400, 1),
	number("Materials", "steepSlope", "Rock slope", 1, 0.2, 3, 0.05),

	// Groves and clearings move props around, so dense biomes average about 8 per chunk at 12.
	number("Assets", "propDensity", "Props per chunk (dense biomes)", 12, 0, 32, 0.5),
	number("Assets", "oreDensity", "Ore field density", 0.75, 0, 4, 0.05),
];

/** Ore clusters per chunk at each `Planet.resources` level (0-4). */
const ORE_DENSITY = [0.3, 0.5, 0.75, 1, 1.3];

export function defaultConfig(): TerrainConfig {
	const out: Record<string, unknown> = {};
	for (const field of TERRAIN_FIELDS) out[field.key] = field.default;
	return out as unknown as TerrainConfig;
}

function snap(field: NumberField, value: number): number {
	const clamped = math.clamp(value, field.min, field.max);
	if (field.step < 1) return clamped;
	return math.clamp(math.round(clamped / field.step) * field.step, field.min, field.max);
}

/**
 * Builds a complete, valid config from untrusted input (the debug panel's JSON).
 * Unknown keys are dropped; wrong types, NaN and infinities fall back to `base`,
 * so a partial update only touches the fields it names; numbers are clamped and
 * snapped to their step.
 */
export function sanitizeConfig(input: unknown, base: TerrainConfig): TerrainConfig {
	const source = (typeIs(input, "table") ? input : {}) as Record<string, unknown>;
	const fallback = base as unknown as Record<string, unknown>;
	const out: Record<string, unknown> = {};

	for (const field of TERRAIN_FIELDS) {
		const value = source[field.key];
		if (field.kind === "number") {
			// `value === value` is false only for NaN.
			const finite = typeIs(value, "number") && value === value && math.abs(value) !== math.huge;
			out[field.key] = finite ? snap(field, value) : fallback[field.key];
		} else {
			const valid = typeIs(value, "string") && field.options.includes(value);
			out[field.key] = valid ? value : fallback[field.key];
		}
	}

	return out as unknown as TerrainConfig;
}

/**
 * The config a planet generates with: its terrain seed and kind, ore clusters
 * from its resources level, and rougher hills and peaks the harder it is. A
 * bigger planet has more of the map playable. The first planet (`index` 0) is
 * always plains, so the tutorial map stays stable.
 */
export function configForPlanet(planet: Planet, index: number, mission: Mission): TerrainConfig {
	const base = defaultConfig();
	// 0.7x the default relief at difficulty 0, 1.3x at 4.
	const rugged = 0.7 + 0.15 * planet.difficulty;
	return sanitizeConfig(
		{
			...base,
			seed: planet.terrainSeed,
			kind: planet.kind,
			oreDensity: ORE_DENSITY[planet.resources] ?? base.oreDensity,
			hillHeight: base.hillHeight * rugged,
			mountainHeight: base.mountainHeight * rugged,
			archetype: index === 0 ? "plains" : "auto",
			// Size 2.5 (smallest) plays on 60% of the map, 7 on all of it.
			mapScale: 0.6 + (0.4 * (planet.size - 2.5)) / 4.5,
			difficulty: planet.difficulty,
			mission,
		},
		base,
	);
}
