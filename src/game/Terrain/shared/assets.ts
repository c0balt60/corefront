import { KIND_ORES, RESOURCES, type ResourceId } from "game/Base/shared/resources";
import { BIOME_SETS } from "game/Terrain/shared/biomes";
import { CELL_STUDS, CHUNK_STUDS, MAP_HALF, cellAt, cellCenter, cellCoords, cellIndex } from "game/Terrain/shared/map";
import { fbm, simplex2, smoothstep } from "game/Terrain/shared/noise";
import { Prng } from "game/Terrain/shared/prng";
import { newColumn, PAD_FLAT, type Sampler } from "game/Terrain/shared/sampler";

/**
 * Prop and ore placement for one chunk. Like the rest of the generator this
 * only returns names and transforms; the worker clones the templates.
 * Candidates sit on global jittered grids, and every grid cell seeds its own
 * stream from a hash of its coordinates, so a chunk places the same things
 * whatever order chunks are built in.
 *
 * Props: each biome sets a density (a fraction of `propDensity`) and its
 * kinds. A grove noise redistributes them, so dense biomes get clearings and
 * sparse ones get groves instead of an even scatter.
 *
 * Ores: infinite deposits, one per 8-stud map cell at its centre, in clusters
 * of 3-7 adjacent cells. Each 32-stud block may hold one cluster, so a cluster
 * never leaves its chunk. Two starter clusters (copper and lead) are always
 * near the landing pad. Ores go first and keep props off their cells.
 */

export interface Placement {
	/** Template name. */
	readonly name: string;
	/** The ground point the template's pivot goes to. */
	readonly x: number;
	readonly y: number;
	readonly z: number;
	/** Radians around the up axis. */
	readonly yaw: number;
	readonly scale: number;
	/** Set on ore deposits. */
	readonly resource?: ResourceId;
	readonly cell?: number;
}

const SALT_PROP = 101;
const SALT_ORE = 102;
const SALT_GROVE = 103;
const SALT_STARTER = 104;

// Prop grid cell size in studs; divides CHUNK_STUDS, so every cell belongs to one chunk.
const PROP_CELL = 16;
// Prop candidates stay this far inside their cell, so neighbours never touch.
const CELL_MARGIN = 3;
const GROVE_SCALE = 180;
// Prop chance is base ^ exponent, the exponent going from CLEARING (grove noise
// low) to GROVE (high). Dense bases saturate into forest with clearings; sparse
// ones only show up where the noise is high, as groves.
const CLEARING_EXPONENT = 3;
const GROVE_EXPONENT = 0.25;
// River or lake channel strength above which nothing is placed.
const RIVER_LIMIT = 0.05;
// Ore blocks are this many map cells square; a block divides a chunk.
const ORE_BLOCK = 4;
const CELLS_PER_CHUNK = CHUNK_STUDS / CELL_STUDS;
// Ores need flatter ground than props (a fraction of steepSlope), so a drill sits level.
const ORE_SLOPE = 0.4;
// Nothing is placed this close to the map centre, where the Core lands...
const LANDING_CLEAR = 40;
// ...or to an alien pad's centre.
const PAD_CLEAR = PAD_FLAT + 8;
// The starter clusters' first cell is this far from the centre.
const STARTER_MIN = 64;
const STARTER_MAX = 136;

// Neighbour offsets for growing ore clusters.
const STEP_X = [1, -1, 0, 0];
const STEP_Z = [0, 0, 1, -1];

/** The template an ore deposit of `resource` clones. */
export function oreTemplate(resource: ResourceId): string {
	return `${RESOURCES[resource].name}Ore`;
}

/** Every prop template name the generator can ask for. */
export const PROP_NAMES: ReadonlyArray<string> = (() => {
	const names = new Array<string>();
	for (const [, set] of pairs(BIOME_SETS)) {
		for (const biome of set.biomes) {
			for (const name of biome.props) if (!names.includes(name)) names.push(name);
		}
	}
	return names;
})();

// 32-bit multiply that stays exact in doubles: split `a` into 16-bit halves.
function mul32(a: number, b: number): number {
	const lo = bit32.band(a, 0xffff);
	const hi = bit32.rshift(a, 16);
	return bit32.band(lo * b + bit32.lshift(bit32.band(hi * b, 0xffff), 16), 0xffffffff);
}

// lowbias32 integer hash. Prng's seeding is linear in its salt, so neighbouring
// cells would get correlated streams; this mixes the coordinates first.
function mix(x: number): number {
	x = bit32.bxor(x, bit32.rshift(x, 16));
	x = mul32(x, 0x7feb352d);
	x = bit32.bxor(x, bit32.rshift(x, 15));
	x = mul32(x, 0x846ca68b);
	return bit32.bxor(x, bit32.rshift(x, 16));
}

function cellRng(seed: number, salt: number, gx: number, gz: number): Prng {
	return new Prng(mix(seed + mix(gx + mix(gz + salt))));
}

/**
 * Rolls a resource from the kind's ore table. Later (rarer) entries favour high
 * ground, like terrain-generator's coal, iron, gold, diamond tiers: in the
 * lowland they come at a quarter of their weight, and the rarer they are, the
 * more they gain going up to the slopes.
 */
function pickOre(
	rng: Prng,
	ores: ReadonlyArray<{ readonly resource: ResourceId; readonly weight: number }>,
	elevation: number,
	slopes: number,
): ResourceId {
	const rise = smoothstep(slopes * 0.25, slopes, elevation);
	const weightOf = (i: number) => ores[i].weight * (i < 2 ? 1 : 0.25 + rise * (i - 1));
	let total = 0;
	for (let i = 0; i < ores.size(); i++) total += weightOf(i);
	let roll = rng.nextNumber() * total;
	for (let i = 0; i < ores.size(); i++) {
		roll -= weightOf(i);
		if (roll < 0) return ores[i].resource;
	}
	return ores[0].resource;
}

/** Grows a cluster of up to `size` 4-connected cells from `start`, keeping to cells `inside` allows. */
function growCluster(rng: Prng, start: number, size: number, inside: (gx: number, gz: number) => boolean) {
	const cells = [start];
	for (let attempt = 0; attempt < size * 4 && cells.size() < size; attempt++) {
		const [gx, gz] = cellCoords(cells[rng.nextInt(cells.size())]);
		const direction = rng.nextInt(4);
		const nx = gx + STEP_X[direction];
		const nz = gz + STEP_Z[direction];
		if (!inside(nx, nz)) continue;
		const cell = cellIndex(nx, nz);
		if (!cells.includes(cell)) cells.push(cell);
	}
	return cells;
}

/** Chunk (cx, cz) counts from the map's -X/-Z corner, 0 to MAP_CHUNKS - 1. */
export function placeAssets(sampler: Sampler, cx: number, cz: number): Array<Placement> {
	const config = sampler.config;
	const set = BIOME_SETS[config.kind];
	const seed = config.seed;
	const seaLevel = config.seaLevel;
	const dry = seaLevel + config.beachHeight + 1;
	const steep = config.steepSlope;
	const height = sampler.height;
	const column = newColumn();
	const out = new Array<Placement>();

	const slopeAt = (x: number, z: number) => {
		const dx = height(x + 4, z) - height(x - 4, z);
		const dz = height(x, z + 4) - height(x, z - 4);
		return math.sqrt(dx * dx + dz * dz) / 8;
	};

	// Away from the landing pad and the alien pads.
	const clear = (x: number, z: number) => {
		if (x * x + z * z < LANDING_CLEAR * LANDING_CLEAR) return false;
		for (const pad of sampler.pads) {
			const dx = x - pad.x;
			const dz = z - pad.z;
			if (dx * dx + dz * dz < PAD_CLEAR * PAD_CLEAR) return false;
		}
		return true;
	};
	const clearCell = (gx: number, gz: number) => {
		const centre = cellCenter(cellIndex(gx, gz));
		return clear(centre.X, centre.Z);
	};

	const taken = new Set<number>();
	const addOre = (cell: number, resource: ResourceId) => {
		const centre = cellCenter(cell);
		taken.add(cell);
		out.push({
			name: oreTemplate(resource),
			x: centre.X,
			y: height(centre.X, centre.Z),
			z: centre.Z,
			// Square to the grid, so a drill sits flush.
			yaw: (cell % 4) * (math.pi / 2),
			scale: 1,
			resource,
			cell,
		});
	};

	// Starter clusters, copper and lead on opposite sides of the landing pad.
	// Every chunk works them out and keeps the cells that fall inside it.
	const starterCells = new Set<number>();
	const starter = new Prng(seed, SALT_STARTER);
	const angle = starter.nextNumber() * 2 * math.pi;
	const starters: ReadonlyArray<ResourceId> = ["copper", "lead"];
	starters.forEach((resource, i) => {
		const a = angle + i * math.pi + (starter.nextNumber() - 0.5);
		const r = STARTER_MIN + starter.nextNumber() * (STARTER_MAX - STARTER_MIN);
		const start = cellAt(math.cos(a) * r, math.sin(a) * r)!;
		for (const cell of growCluster(starter, start, 5 + starter.nextInt(3), clearCell)) {
			starterCells.add(cell);
			const [gx, gz] = cellCoords(cell);
			if (math.floor(gx / CELLS_PER_CHUNK) === cx && math.floor(gz / CELLS_PER_CHUNK) === cz) {
				addOre(cell, resource);
			}
		}
	});

	// Regular clusters: one chance per block, more on resource-rich planets.
	const ores = KIND_ORES[config.kind];
	const blocks = CELLS_PER_CHUNK / ORE_BLOCK;
	const oreChance = config.oreDensity / (blocks * blocks);
	for (let i = 0; i < blocks; i++) {
		for (let j = 0; j < blocks; j++) {
			const bx = cx * blocks + i;
			const bz = cz * blocks + j;
			const rng = cellRng(seed, SALT_ORE, bx, bz);
			if (rng.nextNumber() >= oreChance) continue;

			const gx0 = bx * ORE_BLOCK;
			const gz0 = bz * ORE_BLOCK;
			const start = cellIndex(gx0 + 1 + rng.nextInt(2), gz0 + 1 + rng.nextInt(2));
			const cells = growCluster(
				rng,
				start,
				3 + rng.nextInt(5),
				(gx, gz) => gx >= gx0 && gx < gx0 + ORE_BLOCK && gz >= gz0 && gz < gz0 + ORE_BLOCK,
			);
			const centre = cellCenter(start);
			const resource = pickOre(rng, ores, height(centre.X, centre.Z) - seaLevel, config.slopeElevation);

			for (const cell of cells) {
				if (starterCells.has(cell)) continue;
				const position = cellCenter(cell);
				const x = position.X;
				const z = position.Z;
				if (!clear(x, z)) continue;
				sampler.sample(x, z, column);
				if (column.height < dry || column.river >= RIVER_LIMIT) continue;
				if (slopeAt(x, z) > steep * ORE_SLOPE) continue;
				addOre(cell, resource);
			}
		}
	}

	// Props.
	const groveNoise = simplex2(seed, SALT_GROVE);
	const propCells = CHUNK_STUDS / PROP_CELL;
	const propBase = config.propDensity / (propCells * propCells);
	const span = PROP_CELL - 2 * CELL_MARGIN;
	for (let i = 0; i < propCells; i++) {
		for (let j = 0; j < propCells; j++) {
			const gx = cx * propCells + i;
			const gz = cz * propCells + j;
			const rng = cellRng(seed, SALT_PROP, gx, gz);
			const x = -MAP_HALF + gx * PROP_CELL + CELL_MARGIN + rng.nextNumber() * span;
			const z = -MAP_HALF + gz * PROP_CELL + CELL_MARGIN + rng.nextNumber() * span;
			const chance = rng.nextNumber();
			const cell = cellAt(x, z);
			if ((cell !== undefined && taken.has(cell)) || !clear(x, z)) continue;

			sampler.sample(x, z, column);
			const biome = set.biomes[column.biome];
			const base = math.min(propBase * biome.propDensity, 1);
			if (base <= 0) continue;
			const grove = smoothstep(-0.5, 0.5, fbm(groveNoise, x / GROVE_SCALE, z / GROVE_SCALE, 2));
			const p = base ** (CLEARING_EXPONENT + (GROVE_EXPONENT - CLEARING_EXPONENT) * grove);
			const h = column.height;
			if (chance >= p || h < dry || column.river >= RIVER_LIMIT || column.shore >= 0.5) continue;
			if ((set.snow && h >= column.snowLine) || slopeAt(x, z) > steep * 0.8) continue;

			out.push({
				name: biome.props[rng.nextInt(biome.props.size())],
				x,
				y: h,
				z,
				yaw: rng.nextNumber() * 2 * math.pi,
				scale: 0.8 + rng.nextNumber() * 0.5,
			});
		}
	}

	return out;
}
