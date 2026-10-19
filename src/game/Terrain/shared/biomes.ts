import type { PlanetKind } from "core/Worlds/shared/star-system";

/**
 * Biomes per planet kind, laid out like terrain-generator's Minecraft-style
 * tables but cut down to 3-4 biomes each. Biomes never set the terrain's
 * height: the sampler builds the land first, then looks the biome up from the
 * terrain band (lowland, slopes, peaks, by elevation) and two climate bands
 * (cold/warm, dry/wet). Near a band edge neighbours blend, which only affects
 * the small surface forms; materials and props come from the dominant biome.
 */

/** Names of the per-biome surface forms implemented in the sampler. */
export type Shape = "meadow" | "ridges" | "knolls" | "forest" | "hummocks" | "mesas" | "dunes" | "crags";

export interface Biome {
	readonly name: string;
	readonly shape: Shape;

	readonly surface: Enum.Material;
	/** Replaces `surface` where the patch noise is high. */
	readonly patchHigh: Enum.Material;
	/** Replaces `surface` where the patch noise is low. */
	readonly patchLow: Enum.Material;
	readonly subsurface: Enum.Material;
	/** Cliffs, steep slopes and the deep rock under everything. */
	readonly steep: Enum.Material;
	/** River and lake banks, and shallows. */
	readonly beach: Enum.Material;
	/** River and lake beds. */
	readonly bed: Enum.Material;

	/** 0..1 fraction of `propDensity`. */
	readonly propDensity: number;
	/** Prop template names, picked uniformly. */
	readonly props: ReadonlyArray<string>;
}

export interface BiomeSet {
	readonly biomes: ReadonlyArray<Biome>;
	/** [terrain band][temperature band][humidity band] -> index into `biomes`. */
	readonly layout: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>;
	/**
	 * What fills ground below sea level: Water (the liquid channel), or a solid
	 * material filled up to sea level (Ice, CrackedLava). None leaves dry beds.
	 */
	readonly fluid?: Enum.Material;
	/** Whether the fluid counts as liquid: nothing builds or walks on it. */
	readonly liquid: boolean;
	/** Whether flat ground above the snow line turns to Snow. */
	readonly snow: boolean;
}

/** [lowland, slopes, peaks][cold, warm][dry, wet], written with the biomes themselves. */
type Layout = ReadonlyArray<ReadonlyArray<ReadonlyArray<Biome>>>;

function biomeSet(layout: Layout, rest: Omit<BiomeSet, "biomes" | "layout">): BiomeSet {
	const biomes = new Array<Biome>();
	const indexOf = (biome: Biome) => {
		if (!biomes.includes(biome)) biomes.push(biome);
		return biomes.indexOf(biome);
	};
	const indexed = layout.map((band) => band.map((row) => row.map(indexOf)));
	return { ...rest, biomes, layout: indexed };
}

const GRASSLAND: Biome = {
	name: "Grassland",
	shape: "meadow",
	surface: Enum.Material.Grass,
	patchHigh: Enum.Material.LeafyGrass,
	patchLow: Enum.Material.Grass,
	subsurface: Enum.Material.Ground,
	steep: Enum.Material.Rock,
	beach: Enum.Material.Sand,
	bed: Enum.Material.Sand,
	propDensity: 0.05,
	props: ["Oak", "Birch"],
};
const FOREST: Biome = {
	name: "Forest",
	shape: "forest",
	surface: Enum.Material.LeafyGrass,
	patchHigh: Enum.Material.Grass,
	patchLow: Enum.Material.Mud,
	subsurface: Enum.Material.Ground,
	steep: Enum.Material.Rock,
	beach: Enum.Material.Sand,
	bed: Enum.Material.Sand,
	propDensity: 1,
	props: ["Oak", "Birch"],
};
const MEADOW: Biome = {
	name: "Meadow Highlands",
	shape: "ridges",
	surface: Enum.Material.Grass,
	patchHigh: Enum.Material.LeafyGrass,
	patchLow: Enum.Material.Rock,
	subsurface: Enum.Material.Ground,
	steep: Enum.Material.Rock,
	beach: Enum.Material.Pebble,
	bed: Enum.Material.Pebble,
	propDensity: 0.1,
	props: ["Spruce"],
};
const ROCKY_PEAKS: Biome = {
	name: "Rocky Peaks",
	shape: "crags",
	surface: Enum.Material.Rock,
	patchHigh: Enum.Material.Slate,
	patchLow: Enum.Material.Pebble,
	subsurface: Enum.Material.Rock,
	steep: Enum.Material.Slate,
	beach: Enum.Material.Pebble,
	bed: Enum.Material.Pebble,
	propDensity: 0,
	props: [],
};

const DUST_FLATS: Biome = {
	name: "Dust Flats",
	shape: "dunes",
	surface: Enum.Material.Sand,
	patchHigh: Enum.Material.Ground,
	patchLow: Enum.Material.Sandstone,
	subsurface: Enum.Material.Ground,
	steep: Enum.Material.Sandstone,
	beach: Enum.Material.Sand,
	bed: Enum.Material.Salt,
	propDensity: 0.05,
	props: ["RockSpire"],
};
const MESAS: Biome = {
	name: "Mesas",
	shape: "mesas",
	surface: Enum.Material.Sandstone,
	patchHigh: Enum.Material.Limestone,
	patchLow: Enum.Material.Ground,
	subsurface: Enum.Material.Sandstone,
	steep: Enum.Material.Limestone,
	beach: Enum.Material.Sand,
	bed: Enum.Material.Salt,
	propDensity: 0.15,
	props: ["RockSpire"],
};
const SCRAP_PLAINS: Biome = {
	name: "Scrap Plains",
	shape: "knolls",
	surface: Enum.Material.Pebble,
	patchHigh: Enum.Material.Ground,
	patchLow: Enum.Material.Pebble,
	subsurface: Enum.Material.Ground,
	steep: Enum.Material.Rock,
	beach: Enum.Material.Pebble,
	bed: Enum.Material.Pebble,
	propDensity: 0.1,
	props: ["RockSpire"],
};
const BARREN_CRAGS: Biome = {
	name: "Rock Crags",
	shape: "crags",
	surface: Enum.Material.Rock,
	patchHigh: Enum.Material.Basalt,
	patchLow: Enum.Material.Pebble,
	subsurface: Enum.Material.Rock,
	steep: Enum.Material.Basalt,
	beach: Enum.Material.Pebble,
	bed: Enum.Material.Pebble,
	propDensity: 0.3,
	props: ["RockSpire"],
};

const SNOWFIELD: Biome = {
	name: "Snowfield",
	shape: "knolls",
	surface: Enum.Material.Snow,
	patchHigh: Enum.Material.Glacier,
	patchLow: Enum.Material.Snow,
	subsurface: Enum.Material.Slate,
	steep: Enum.Material.Slate,
	beach: Enum.Material.Snow,
	bed: Enum.Material.Pebble,
	propDensity: 0.03,
	props: ["SnowySpruce"],
};
const GLACIER: Biome = {
	name: "Ice Sheet",
	shape: "hummocks",
	surface: Enum.Material.Glacier,
	patchHigh: Enum.Material.Ice,
	patchLow: Enum.Material.Snow,
	subsurface: Enum.Material.Ice,
	steep: Enum.Material.Glacier,
	beach: Enum.Material.Snow,
	bed: Enum.Material.Ice,
	propDensity: 0,
	props: [],
};
const FROST_TAIGA: Biome = {
	name: "Frost Taiga",
	shape: "forest",
	surface: Enum.Material.Snow,
	patchHigh: Enum.Material.Snow,
	patchLow: Enum.Material.Ground,
	subsurface: Enum.Material.Ground,
	steep: Enum.Material.Slate,
	beach: Enum.Material.Pebble,
	bed: Enum.Material.Ground,
	propDensity: 1,
	props: ["SnowySpruce"],
};
const SLATE_PEAKS: Biome = {
	name: "Slate Peaks",
	shape: "crags",
	surface: Enum.Material.Slate,
	patchHigh: Enum.Material.Snow,
	patchLow: Enum.Material.Rock,
	subsurface: Enum.Material.Slate,
	steep: Enum.Material.Slate,
	beach: Enum.Material.Pebble,
	bed: Enum.Material.Pebble,
	propDensity: 0,
	props: [],
};

const ASH_PLAINS: Biome = {
	name: "Ash Plains",
	shape: "meadow",
	surface: Enum.Material.Slate,
	patchHigh: Enum.Material.Asphalt,
	patchLow: Enum.Material.Ground,
	subsurface: Enum.Material.Ground,
	steep: Enum.Material.Basalt,
	beach: Enum.Material.Asphalt,
	bed: Enum.Material.Basalt,
	propDensity: 0.05,
	props: ["CharredSpike"],
};
const BASALT_FIELDS: Biome = {
	name: "Basalt Fields",
	shape: "knolls",
	surface: Enum.Material.Basalt,
	patchHigh: Enum.Material.CrackedLava,
	patchLow: Enum.Material.Asphalt,
	subsurface: Enum.Material.Basalt,
	steep: Enum.Material.Basalt,
	beach: Enum.Material.Asphalt,
	bed: Enum.Material.Basalt,
	propDensity: 0.15,
	props: ["CharredSpike"],
};
const BASALT_CRAGS: Biome = {
	name: "Basalt Crags",
	shape: "crags",
	surface: Enum.Material.Basalt,
	patchHigh: Enum.Material.Rock,
	patchLow: Enum.Material.Slate,
	subsurface: Enum.Material.Basalt,
	steep: Enum.Material.Rock,
	beach: Enum.Material.Basalt,
	bed: Enum.Material.Basalt,
	propDensity: 0.3,
	props: ["CharredSpike"],
};

export const BIOME_SETS: Record<PlanetKind, BiomeSet> = {
	Habitable: biomeSet(
		[
			[
				[MEADOW, FOREST],
				[GRASSLAND, FOREST],
			],
			[
				[MEADOW, MEADOW],
				[MEADOW, FOREST],
			],
			[
				[ROCKY_PEAKS, ROCKY_PEAKS],
				[ROCKY_PEAKS, ROCKY_PEAKS],
			],
		],
		{ fluid: Enum.Material.Water, liquid: true, snow: true },
	),
	Barren: biomeSet(
		[
			[
				[SCRAP_PLAINS, DUST_FLATS],
				[DUST_FLATS, MESAS],
			],
			[
				[BARREN_CRAGS, MESAS],
				[MESAS, MESAS],
			],
			[
				[BARREN_CRAGS, BARREN_CRAGS],
				[BARREN_CRAGS, BARREN_CRAGS],
			],
		],
		{ liquid: false, snow: false },
	),
	Frozen: biomeSet(
		[
			[
				[GLACIER, SNOWFIELD],
				[SNOWFIELD, FROST_TAIGA],
			],
			[
				[SLATE_PEAKS, SNOWFIELD],
				[SNOWFIELD, FROST_TAIGA],
			],
			[
				[SLATE_PEAKS, SLATE_PEAKS],
				[SLATE_PEAKS, SLATE_PEAKS],
			],
		],
		{ fluid: Enum.Material.Ice, liquid: false, snow: true },
	),
	Volcanic: biomeSet(
		[
			[
				[ASH_PLAINS, BASALT_FIELDS],
				[BASALT_FIELDS, ASH_PLAINS],
			],
			[
				[BASALT_FIELDS, BASALT_CRAGS],
				[BASALT_CRAGS, BASALT_FIELDS],
			],
			[
				[BASALT_CRAGS, BASALT_CRAGS],
				[BASALT_CRAGS, BASALT_CRAGS],
			],
		],
		{ fluid: Enum.Material.CrackedLava, liquid: true, snow: false },
	),
};
