import { BIOME_SETS, type BiomeSet } from "game/Terrain/shared/biomes";
import type { TerrainConfig } from "game/Terrain/shared/config";
import { CHUNK_STUDS, MAP_HALF } from "game/Terrain/shared/map";
import { type Column, newColumn, type Sampler, WORLD_BOTTOM, WORLD_TOP } from "game/Terrain/shared/sampler";

/**
 * Builds the voxel channels for one chunk, in the exact [x][y][z] shape
 * `Terrain.WriteVoxelChannels` takes. Water is the separate liquid channel, so
 * a partly solid shoreline voxel also holds water instead of leaving a seam.
 * Solid fluids (ice, lava) fill the same space with a solid material instead.
 */

/** Roblox terrain resolution; WriteVoxelChannels only accepts 4. */
export const VOXEL = 4;

const N = CHUNK_STUDS / VOXEL;
// Grid with a one-column border on every side, so slopes at the chunk edge use
// real neighbour heights and adjacent chunks agree on their materials.
const B = N + 2;
// Solid layers under the surface before switching to deep rock.
const SUBSURFACE_DEPTH = 12;
// Underwater ground this close to the surface near a shore uses the beach material.
const SHALLOWS = 6;
// Patch noise thresholds for a biome's alternate surface materials.
const PATCH_HIGH = 0.3;
const PATCH_LOW = -0.4;

export interface Chunk {
	/** Region minimum corner in studs; it is CHUNK_STUDS wide and deep and `sizeY` tall. */
	readonly minX: number;
	readonly minY: number;
	readonly minZ: number;
	readonly sizeY: number;
	readonly materials: Array<Array<Array<Enum.Material>>>;
	readonly occupancy: Array<Array<Array<number>>>;
	readonly liquid: Array<Array<Array<number>>>;
}

/** Surface, subsurface and deep materials for one column. */
function columnMaterials(config: TerrainConfig, set: BiomeSet, column: Column, slope: number) {
	const biome = set.biomes[column.biome];
	const seaLevel = config.seaLevel;
	const steep = config.steepSlope;
	const height = column.height;
	const patch = column.patch;
	const deep = biome.steep;

	if (height < seaLevel - 1) {
		if (height > seaLevel - SHALLOWS && column.shore > 0.3) return $tuple(biome.beach, biome.beach, deep);
		return $tuple(biome.bed, biome.subsurface, deep);
	} else if (
		height < seaLevel + config.beachHeight + 1.5 + patch * 1.5 &&
		(column.shore > 0.5 || height < seaLevel + 1.5) &&
		slope < steep * 2.5
	) {
		// Low ground at the water stays beach even on steepish banks; the patch
		// noise keeps the beach's inland edge from tracing a contour line.
		return $tuple(biome.beach, biome.beach, deep);
	} else if (slope > steep) {
		return $tuple(biome.steep, biome.steep, deep);
	} else if (set.snow && height > column.snowLine && slope < steep * 0.8) {
		return $tuple(Enum.Material.Snow, biome.subsurface, deep);
	} else if (slope > steep * 0.8) {
		return $tuple(biome.subsurface, biome.subsurface, deep);
	} else if (patch > PATCH_HIGH) {
		return $tuple(biome.patchHigh, biome.subsurface, deep);
	} else if (patch < PATCH_LOW) {
		return $tuple(biome.patchLow, biome.subsurface, deep);
	}
	return $tuple(biome.surface, biome.subsurface, deep);
}

/** Chunk (cx, cz) counts from the map's -X/-Z corner, 0 to MAP_CHUNKS - 1. */
export function buildChunk(sampler: Sampler, cx: number, cz: number): Chunk {
	const config = sampler.config;
	const set = BIOME_SETS[config.kind];
	const seaLevel = config.seaLevel;
	const fluid = set.fluid;
	const water = fluid === Enum.Material.Water;
	const minX = -MAP_HALF + cx * CHUNK_STUDS;
	const minZ = -MAP_HALF + cz * CHUNK_STUDS;

	// Pass 1: sample every column (plus border) at voxel centres. Border columns
	// only need their height, so they share one scratch table.
	const heights = new Array<number>(B * B, 0);
	const columns = new Array<Column>(N * N);
	const border = newColumn();
	let top = seaLevel;
	for (let i = 0; i < B; i++) {
		const wx = minX + (i - 1) * VOXEL + VOXEL / 2;
		const interiorX = i >= 1 && i <= N;
		for (let j = 0; j < B; j++) {
			const wz = minZ + (j - 1) * VOXEL + VOXEL / 2;
			if (interiorX && j >= 1 && j <= N) {
				const column = sampler.sample(wx, wz, newColumn());
				columns[(i - 1) * N + j - 1] = column;
				heights[i * B + j] = column.height;
				if (column.height > top) top = column.height;
			} else {
				heights[i * B + j] = sampler.sample(wx, wz, border).height;
			}
		}
	}

	// The region only reaches as high as this chunk needs; everything above is air already.
	const yVoxBottom = WORLD_BOTTOM / VOXEL;
	const yVoxTop = math.min(math.ceil(top / VOXEL) + 1, WORLD_TOP / VOXEL);
	const ny = yVoxTop - yVoxBottom;

	const materials = new Array<Array<Array<Enum.Material>>>(N);
	const occupancy = new Array<Array<Array<number>>>(N);
	const liquid = new Array<Array<Array<number>>>(N);
	for (let x = 0; x < N; x++) {
		const mx = new Array<Array<Enum.Material>>(ny);
		const ox = new Array<Array<number>>(ny);
		const lx = new Array<Array<number>>(ny);
		for (let y = 0; y < ny; y++) {
			mx[y] = new Array<Enum.Material>(N, Enum.Material.Air);
			ox[y] = new Array<number>(N, 0);
			lx[y] = new Array<number>(N, 0);
		}
		materials[x] = mx;
		occupancy[x] = ox;
		liquid[x] = lx;
	}

	// Pass 2: fill voxels column by column, counting material layers down from the surface.
	for (let x = 0; x < N; x++) {
		const mx = materials[x];
		const ox = occupancy[x];
		const lx = liquid[x];
		for (let z = 0; z < N; z++) {
			// This column in the bordered height grid.
			const hi = (x + 1) * B + z + 1;
			const h = heights[hi];
			const dhx = heights[hi + B] - heights[hi - B];
			const dhz = heights[hi + 1] - heights[hi - 1];
			const slope = math.sqrt(dhx * dhx + dhz * dhz) / (2 * VOXEL);
			const [surface, sub, deep] = columnMaterials(config, set, columns[x * N + z], slope);

			for (let y = 0; y < ny; y++) {
				const yb = (yVoxBottom + y) * VOXEL;
				const ground = math.clamp((h - yb) / VOXEL, 0, 1);
				if (ground <= 0 && yb >= seaLevel) break; // Above the surface and the fluid: the rest is air.

				if (ground > 0) {
					const depth = h - (yb + VOXEL);
					mx[y][z] = depth < VOXEL ? surface : depth < SUBSURFACE_DEPTH ? sub : deep;
					ox[y][z] = ground;
				}
				if (fluid && ground < 1 && yb < seaLevel) {
					const fill = math.clamp((seaLevel - yb) / VOXEL, 0, 1);
					if (water) {
						lx[y][z] = fill;
					} else if (fill > ground) {
						mx[y][z] = fluid;
						ox[y][z] = fill;
					}
				}
			}
		}
	}

	return {
		minX,
		minY: yVoxBottom * VOXEL,
		minZ,
		sizeY: ny * VOXEL,
		materials,
		occupancy,
		liquid,
	};
}
