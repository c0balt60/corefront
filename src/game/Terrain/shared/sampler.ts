import { BIOME_SETS, type Shape } from "game/Terrain/shared/biomes";
import type { TerrainConfig } from "game/Terrain/shared/config";
import { type Layout, layoutFor } from "game/Terrain/shared/layout";
import { erodedFbm, erodedRidged, fbm, ridged, simplex2, simplex2d, smoothstep } from "game/Terrain/shared/noise";

/**
 * Column sampler: turns a world (x, z) into everything the chunk builder needs
 * about that column. Terrain comes first and biomes follow it, so a biome never
 * decides how high the land is. Tailored from terrain-generator for a finite
 * tower-defence map:
 *
 * 1. Land: plains and eroded fractal hills, mixed by a low-frequency relief noise.
 * 2. Mountains: ranges follow the zero lines of warped noise: a broad uplift
 *    with eroded ridged peaks on top. None near the Core, and damped along the paths.
 * 3. Layout walls: the layout's cliff field rises steeply, with ridged detail on top;
 *    its mountain field climbs on rough slopes to a craggy peak.
 * 4. Biomes: the kind's tables, by terrain band and climate, blended at edges.
 * 5. Water: rivers where a noise crosses zero and lakes where another peaks,
 *    carved below sea level and fading out as the land rises.
 * 6. Pads: the landing pad and the spawn pads are flattened last, so
 *    nothing cuts into them.
 */

/** Vertical extent of the terrain in studs; multiples of the 4-stud voxel. */
export const WORLD_BOTTOM = -32;
export const WORLD_TOP = 512;

/** Drop zone pads are flat out to this radius; an attack base site is flat out to `SITE_FLAT`. */
export const PAD_FLAT = 24;
export const SITE_FLAT = 96;

// Salts keep each layer's permutation independent for the same seed.
const SALT_DETAIL = 2;
const SALT_MOUNTAIN = 3;
const SALT_RANGE = 4;
const SALT_TEMPERATURE = 5;
const SALT_MOISTURE = 6;
const SALT_RIVER = 7;
const SALT_RANGE_WARP = 8;
const SALT_PATCH = 11;
const SALT_HILLS = 12;
const SALT_RELIEF = 13;
const SALT_SHAPE = 14;
const SALT_SHAPE_ALT = 15;
const SALT_LAKE = 20;
const SALT_EDGE = 21;

const MIN_HEIGHT = WORLD_BOTTOM + 8;
const MAX_HEIGHT = WORLD_TOP - 8;

// Dry land and banks settle this far above sea level.
const BANK_HEIGHT = 2;
// Biome forms with less weight than this are skipped. The rest are rescaled
// from this cut, so skipping them doesn't leave a seam.
const SHAPE_CUTOFF = 0.02;
// Half-width, in studs of elevation, of the blend between terrain bands.
const TERRAIN_BLEND = 10;
// Snow line shift per unit of temperature: colder climates snow lower down.
const SNOW_PER_TEMPERATURE = 60;
// The snow line never comes lower than this far above the start of the slopes.
const SNOW_FLOOR = 20;
// Range line warp amplitude in range-noise units. A strong warp squeezes ranges into walls.
const RANGE_WARP = 0.2;
// Typical slope of the range noise per unit: |noise| / this ~ distance to the range line.
const RANGE_SLOPE = 2.5;
// Width of the peaked spine as a fraction of the whole range width.
const SPINE_WIDTH = 0.45;
// How far the detail noise shifts the elevation used to pick biomes, so band
// edges wander instead of tracing contour lines.
const ELEVATION_JITTER = 12;
// One edge splits each climate noise in two: cold/warm and dry/wet.
const CLIMATE_EDGES = [0];

// Ridged noise scale of the layout walls.
const EDGE_SCALE = 90;
// The landing pad: flat to LANDING_FLAT, back to the natural ground by LANDING_FALLOFF.
const LANDING_FLAT = 48;
const LANDING_FALLOFF = 96;
// Mountains, rivers and lakes fade in between these distances from the Core.
const CALM_INNER = 150;
const CALM_OUTER = 250;
// Natural mountains fade out within PATH_CLEAR of a path, back in over PATH_BLEND more.
const PATH_CLEAR = 40;
const PATH_BLEND = 60;
// A pad's flat radius is blended back to the natural ground over this many studs.
const PAD_BLEND = 32;
// The wall profile: nothing below WALL_FOOT, full height from WALL_TOP, steep between.
const WALL_FOOT = 0.1;
const WALL_TOP = 0.6;
// Layout mountains peak at this share of the wall height, with crags at this ridged noise scale.
const MASS_HEIGHT = 1;
const MASS_CRAG = 140;
// Pads sit at least this far above sea level, so no water reaches them.
const PAD_MIN_HEIGHT = 6;

/** Everything known about one column. `sample` fills one in place, so a chunk reuses tables. */
export interface Column {
	/** Surface Y in studs. */
	height: number;
	/** Index into the kind's `BiomeSet.biomes` of the dominant biome. */
	biome: number;
	/** 0..1 river or lake channel strength. */
	river: number;
	/** 0..1, 1 on banks and shallows. */
	shore: number;
	/** Roughly -1..1 noise choosing material patches. */
	patch: number;
	/** Y above which flat ground turns to snow. */
	snowLine: number;
}

export interface Sampler {
	readonly config: TerrainConfig;
	/** Where the Core, spawns and cliff walls are. */
	readonly layout: Layout;
	readonly sample: (x: number, z: number, column: Column) => Column;
	/** Heightmap ground height. */
	readonly height: (x: number, z: number) => number;
	/** Whether liquid (water, lava) covers the ground. */
	readonly isLiquid: (x: number, z: number) => boolean;
}

export function newColumn(): Column {
	return { height: 0, biome: 0, river: 0, shore: 0, patch: 0, snowLine: 0 };
}

/**
 * Finds the band `x` falls in among the sorted `edges` (band 0 is below the
 * first edge). Within `halfWidth` of an edge it returns the bands on both sides
 * and the weight of the upper one; otherwise the same band twice and 0.
 */
function findBand(edges: ReadonlyArray<number>, x: number, halfWidth: number) {
	let i = 0;
	const count = edges.size();
	while (i < count && x >= edges[i]) i++;
	if (i < count && edges[i] - x < halfWidth) {
		return $tuple(i, i + 1, smoothstep(-halfWidth, halfWidth, x - edges[i]));
	} else if (i > 0 && x - edges[i - 1] < halfWidth) {
		return $tuple(i - 1, i, smoothstep(-halfWidth, halfWidth, x - edges[i - 1]));
	}
	return $tuple(i, i, 0);
}

/** Polynomial smooth maximum: max(a, b) with the corner rounded over width k. */
function smoothMax(a: number, b: number, k: number): number {
	const h = math.clamp(0.5 + (0.5 * (a - b)) / k, 0, 1);
	return b + (a - b) * h + k * h * (1 - h);
}

export function newSampler(config: TerrainConfig): Sampler {
	const seed = config.seed;
	const set = BIOME_SETS[config.kind];

	const detailNoise = simplex2(seed, SALT_DETAIL);
	const mountainNoise = simplex2d(seed, SALT_MOUNTAIN);
	const rangeNoise = simplex2(seed, SALT_RANGE);
	const rangeWarpNoise = simplex2(seed, SALT_RANGE_WARP);
	const temperatureNoise = simplex2(seed, SALT_TEMPERATURE);
	const moistureNoise = simplex2(seed, SALT_MOISTURE);
	const riverNoise = simplex2(seed, SALT_RIVER);
	const lakeNoise = simplex2(seed, SALT_LAKE);
	const patchNoise = simplex2(seed, SALT_PATCH);
	const hillNoise = simplex2d(seed, SALT_HILLS);
	const reliefNoise = simplex2(seed, SALT_RELIEF);
	const shapeNoise = simplex2(seed, SALT_SHAPE);
	const shapeAltNoise = simplex2(seed, SALT_SHAPE_ALT);
	const edgeNoise = simplex2(seed, SALT_EDGE);

	const invDetail = 1 / config.detailScale;
	const invHill = 1 / config.hillScale;
	const invRelief = 1 / config.reliefScale;
	const invRange = 1 / config.rangeScale;
	const rangeDistance = config.rangeScale / RANGE_SLOPE;
	const invMountain = 1 / config.mountainScale;
	const invBiome = 1 / config.biomeScale;
	const invRiver = 1 / config.riverScale;
	const invLake = 1 / config.lakeScale;

	const layout = layoutFor(config);
	const core = layout.core;
	const sheerAt = layout.sheer;
	const massAt = layout.mountain;
	// The paths as flat segments (ax, az, bx, bz, ...), for the squared distance test.
	const segments = new Array<number>();
	for (const path of layout.paths) {
		for (let i = 1; i < path.size(); i++) segments.push(path[i - 1].x, path[i - 1].z, path[i].x, path[i].z);
	}
	/** Squared distance to the nearest path segment, or `limit` if none is nearer. */
	const pathDistanceSq = (x: number, z: number, limit: number) => {
		let best = limit;
		for (let i = 0; i < segments.size(); i += 4) {
			const ax = segments[i];
			const az = segments[i + 1];
			const dx = segments[i + 2] - ax;
			const dz = segments[i + 3] - az;
			const length = dx * dx + dz * dz;
			const t = length > 0 ? math.clamp(((x - ax) * dx + (z - az) * dz) / length, 0, 1) : 0;
			const ex = x - ax - dx * t;
			const ez = z - az - dz * t;
			best = math.min(best, ex * ex + ez * ez);
		}
		return best;
	};

	const seaLevel = config.seaLevel;
	const landHeight = config.landHeight;
	const detailStrength = config.detailStrength;
	const hillHeight = config.hillHeight;
	const erosion = config.erosion;
	const rangeWidth = config.rangeWidth;
	const mountainBase = config.mountainBase;
	const mountainHeight = config.mountainHeight;
	const wallHeight = config.wallHeight;
	const climateBlend = config.biomeBlend;
	const temperatureBias = config.temperatureBias;
	const moistureBias = config.moistureBias;
	const riverWidth = config.riverWidth;
	const riverDepth = config.riverDepth;
	const riverMaxElevation = config.riverMaxElevation;
	const lakeAmount = config.lakeAmount;
	// Lakes fill where the lake noise passes this; 0.5 is a rare pond, 0 a third of the map.
	const lakeEdge = 0.5 - 0.5 * lakeAmount;
	const snowLine = config.snowLine;

	// Terrain band edges. Each band is kept wider than the blend between them.
	const slopeEdge = math.max(config.slopeElevation, 2 * TERRAIN_BLEND + 1);
	const peakEdge = math.max(config.peakElevation, slopeEdge + 2 * TERRAIN_BLEND + 1);
	const terrainEdges = [slopeEdge, peakEdge];
	const snowFloor = slopeEdge + SNOW_FLOOR;

	// Biome surface forms: continuous offsets in studs on top of the land. The
	// coordinate offsets stop forms that share a noise from lining up.
	const shapes: Record<Shape, (x: number, z: number) => number> = {
		// Gentle undulation; the land's own hills do the rest.
		meadow: (x, z) => fbm(shapeNoise, x / 600, z / 600, 2) * 6 + fbm(shapeAltNoise, x / 140, z / 140, 2) * 3,
		// Uneven ridgelines.
		ridges: (x, z) => ridged(shapeNoise, x / 360 + 41.7, z / 360 - 12.3, 3) * 28 - 8,
		// Low rocky knolls.
		knolls: (x, z) => {
			const n = ridged(shapeAltNoise, x / 200 - 73.1, z / 200 + 5.9, 3);
			return n * n * 20 - 3;
		},
		// Busy, medium-scale hills.
		forest: (x, z) => fbm(shapeNoise, x / 300 - 19.4, z / 300 + 88.2, 4) * 16,
		// Small bumps and shallow dips.
		hummocks: (x, z) => {
			const pools = smoothstep(0.1, 0.4, fbm(shapeAltNoise, x / 150 + 7.7, z / 150 + 61.3, 2));
			return fbm(shapeNoise, x / 40, z / 40, 2) * 2.5 - pools * 6;
		},
		// Two-tier flat-topped mesas with steep sides.
		mesas: (x, z) => {
			const n = fbm(shapeAltNoise, x / 420 + 33.3, z / 420 - 47.5, 3) * 0.5 + 0.5;
			return (
				smoothstep(0.56, 0.6, n) * 26 +
				smoothstep(0.68, 0.71, n) * 18 +
				fbm(shapeNoise, x / 200 + 5.1, z / 200 + 5.1, 2) * 5
			);
		},
		// Wind-aligned dunes: a long windward rise and a short, steeper lee face.
		dunes: (x, z) => {
			const warp = fbm(shapeNoise, x / 500 - 60.6, z / 500 + 2.2, 2) * 1.2;
			const v = (x * 0.8 + z * 0.6) / 120 + warp;
			const f = v - math.floor(v);
			let p = f < 0.8 ? f / 0.8 : (1 - f) / 0.2;
			p = p * p * (3 - 2 * p);
			return p * (8 + 10 * (fbm(shapeAltNoise, x / 700 - 9.9, z / 700 - 9.9, 2) * 0.5 + 0.5));
		},
		// Sharp, broken rock on the high peaks.
		crags: (x, z) => {
			const n = ridged(shapeAltNoise, x / 110 + 27.4, z / 110 - 93.6, 3);
			return n * n * 16 - 4;
		},
	};

	const tables = set.layout;
	const shapeOf = set.biomes.map((biome) => shapes[biome.shape]);

	// Per-biome weight of the column being sampled, and which entries are set.
	const weights = new Array<number>(set.biomes.size(), 0);
	const touched = new Array<number>();
	let touchedCount = 0;
	let t0 = 0;
	let t1 = 0;
	let tw = 0;
	let h0 = 0;
	let h1 = 0;
	let hw = 0;

	const addBiome = (biome: number, w: number) => {
		if (w <= 0) return;
		if (weights[biome] === 0) {
			touched[touchedCount] = biome;
			touchedCount += 1;
		}
		weights[biome] += w;
	};

	// Adds the four climate corners of one terrain band.
	const addBand = (terrain: number, w: number) => {
		if (w <= 0) return;
		const lookup = tables[terrain];
		const cold = lookup[t0];
		const warm = lookup[t1];
		addBiome(cold[h0], w * (1 - tw) * (1 - hw));
		addBiome(cold[h1], w * (1 - tw) * hw);
		addBiome(warm[h0], w * tw * (1 - hw));
		addBiome(warm[h1], w * tw * hw);
	};

	/** Everything but the pads. */
	const sampleRaw = (x: number, z: number, column: Column): Column => {
		const detail = fbm(detailNoise, x * invDetail, z * invDetail, 4);
		const calm = smoothstep(CALM_INNER, CALM_OUTER, math.sqrt((x - core.x) ** 2 + (z - core.z) ** 2));

		// 1. Land: plains where the relief noise is low, eroded hills where it is high.
		let land = landHeight;
		const relief = smoothstep(-0.35, 0.45, fbm(reliefNoise, x * invRelief, z * invRelief, 2));
		if (relief > 0 && hillHeight > 0) {
			const hills = erodedFbm(hillNoise, x * invHill, z * invHill, 4, erosion) * 0.5 + 0.5;
			land += hillHeight * relief * hills;
		}

		// 2. Mountain ranges follow the line where warped noise crosses zero. |f|
		// over the noise's typical slope approximates the distance to that line.
		let mountain = 0;
		if (calm > 0 && (mountainBase > 0 || mountainHeight > 0)) {
			const rx = x * invRange;
			const rz = z * invRange;
			const wx = rx + fbm(rangeWarpNoise, rx * 0.5, rz * 0.5, 2) * RANGE_WARP;
			const wz = rz + fbm(rangeWarpNoise, rx * 0.5 + 17.3, rz * 0.5 - 9.1, 2) * RANGE_WARP;
			const distance = math.abs(fbm(rangeNoise, wx, wz, 2)) * rangeDistance;

			let foothills = 1 - smoothstep(0, rangeWidth, distance);
			foothills *= foothills;
			const spine = 1 - smoothstep(0, rangeWidth * SPINE_WIDTH, distance);
			mountain = mountainBase * foothills;
			if (spine > 0) {
				const ridge = erodedRidged(mountainNoise, x * invMountain, z * invMountain, 5, erosion);
				mountain += mountainHeight * spine * ridge * ridge;
			}
			mountain *= calm;
			// Natural ranges never block a path.
			const limit = (PATH_CLEAR + PATH_BLEND) ** 2;
			const near = pathDistanceSq(x, z, limit);
			if (near < limit) mountain *= smoothstep(PATH_CLEAR, PATH_CLEAR + PATH_BLEND, math.sqrt(near));
		}

		// 3. Layout walls: a steep profile, so they read as cliffs, with ridged detail on top. Mountains rise
		// with their field instead, so they slope, and the higher of the two stands.
		const wall = smoothstep(WALL_FOOT, WALL_TOP, sheerAt(x, z));
		const mass = massAt(x, z);
		if ((wall > 0 || mass > 0) && wallHeight > 0) {
			const cliff = wall * (0.75 + 0.25 * ridged(edgeNoise, x / EDGE_SCALE, z / EDGE_SCALE, 3));
			const peak =
				mass > 0
					? MASS_HEIGHT * mass * (0.6 + 0.4 * ridged(edgeNoise, x / MASS_CRAG + 17.1, z / MASS_CRAG - 4.2, 4))
					: 0;
			mountain += wallHeight * math.max(cliff, peak);
		}

		// Fine detail grows rougher with height: low ground stays smooth, peaks get craggy.
		let raised = land + mountain;
		raised += detail * detailStrength * (2 + 8 * smoothstep(20, 150, raised));
		// Dry land stays above the bank height so no stray ponds form.
		raised = smoothMax(raised, BANK_HEIGHT, 4);

		// 4. Biomes: climate bands and the terrain band pick up to eight table
		// entries, weighted by how close the column is to each band edge.
		const bx = x * invBiome;
		const bz = z * invBiome;
		const temperature = fbm(temperatureNoise, bx, bz, 2) * 1.8 + temperatureBias;
		const humidity = fbm(moistureNoise, bx, bz, 3) * 1.8 + moistureBias;
		const e = raised + detail * ELEVATION_JITTER;

		const [ta, tb, tWeight] = findBand(CLIMATE_EDGES, temperature, climateBlend);
		const [ha, hb, hWeight] = findBand(CLIMATE_EDGES, humidity, climateBlend);
		const [e0, e1, eWeight] = findBand(terrainEdges, e, TERRAIN_BLEND);
		t0 = ta;
		t1 = tb;
		tw = tWeight;
		h0 = ha;
		h1 = hb;
		hw = hWeight;
		touchedCount = 0;
		addBand(e0, 1 - eWeight);
		addBand(e1, eWeight);

		let dominant = 0;
		let best = 0;
		let shape = 0;
		let shapeTotal = 0;
		for (let k = 0; k < touchedCount; k++) {
			const i = touched[k];
			const w = weights[i];
			weights[i] = 0;
			if (w > best) {
				best = w;
				dominant = i;
			}
			const sw = w - SHAPE_CUTOFF;
			if (sw > 0) {
				shapeTotal += sw;
				shape += sw * shapeOf[i](x, z);
			}
		}
		shape /= shapeTotal;

		raised = smoothMax(raised + shape, BANK_HEIGHT, 4);
		let height = seaLevel + raised;

		// 5. Water. A wide valley first lowers the land toward the banks, then a
		// narrow channel is cut below sea level, so banks slope instead of cliffing.
		let river = 0;
		let shore = 0;
		const fade = calm * (1 - smoothstep(riverMaxElevation * 0.5, riverMaxElevation, height - seaLevel));
		if (fade > 0) {
			let valley = 0;
			let channel = 0;
			let bank = 0;
			if (riverWidth > 0) {
				const band = math.abs(fbm(riverNoise, x * invRiver, z * invRiver, 3));
				valley = 1 - smoothstep(riverWidth * 0.6, riverWidth * 5, band);
				channel = 1 - smoothstep(riverWidth * 0.3, riverWidth * 1.3, band);
				bank = 1 - smoothstep(riverWidth * 1.8, riverWidth * 2.8, band);
			}
			if (lakeAmount > 0) {
				const lake = fbm(lakeNoise, x * invLake, z * invLake, 2);
				valley = math.max(valley, smoothstep(lakeEdge - 0.15, lakeEdge, lake));
				channel = math.max(channel, smoothstep(lakeEdge, lakeEdge + 0.08, lake));
				bank = math.max(bank, smoothstep(lakeEdge - 0.05, lakeEdge + 0.02, lake));
			}

			const bankY = seaLevel + BANK_HEIGHT;
			if (height > bankY) height += (bankY - height) * valley * fade;
			river = channel * fade;
			const bed = seaLevel - riverDepth;
			if (height > bed) height += (bed - height) * river;
			shore = bank * fade;
		}

		column.height = math.clamp(height, MIN_HEIGHT, MAX_HEIGHT);
		column.biome = dominant;
		column.river = river;
		column.shore = shore;
		column.patch = fbm(patchNoise, x / 80, z / 80, 3) + detail * 0.2;
		column.snowLine = seaLevel + math.max(snowLine + temperature * SNOW_PER_TEMPERATURE, snowFloor) + detail * 12;
		return column;
	};

	const scratch = newColumn();
	const padHeight = (x: number, z: number) => math.max(sampleRaw(x, z, scratch).height, seaLevel + PAD_MIN_HEIGHT);

	// The landing pad sits at the Core; its 2x2 cells meet there.
	const landing = padHeight(core.x, core.z);

	// Flat pads at the spawns: small for drop zones, wide for enemy base sites.
	const padFlat = config.mission === "attack" ? SITE_FLAT : PAD_FLAT;
	const padFalloff = padFlat + PAD_BLEND;
	const pads = layout.spawns.map((spawn) => ({ x: spawn.x, z: spawn.z, height: padHeight(spawn.x, spawn.z) }));

	// Blends the column to `target` with weight `w`, drying it out as it goes.
	const flattenTo = (column: Column, target: number, w: number) => {
		column.height += (target - column.height) * w;
		column.river *= 1 - w;
		column.shore *= 1 - w;
	};

	const sample = (x: number, z: number, column: Column): Column => {
		sampleRaw(x, z, column);
		const fromCentre = math.sqrt((x - core.x) ** 2 + (z - core.z) ** 2);
		if (fromCentre < LANDING_FALLOFF) {
			flattenTo(column, landing, 1 - smoothstep(LANDING_FLAT, LANDING_FALLOFF, fromCentre));
		}
		for (const pad of pads) {
			const dx = x - pad.x;
			const dz = z - pad.z;
			const distance = math.sqrt(dx * dx + dz * dz);
			if (distance < padFalloff) flattenTo(column, pad.height, 1 - smoothstep(padFlat, padFalloff, distance));
		}
		return column;
	};

	const height = (x: number, z: number) => sample(x, z, scratch).height;

	return {
		config,
		layout,
		sample,
		height,
		isLiquid: (x, z) => set.liquid && height(x, z) < seaLevel,
	};
}
