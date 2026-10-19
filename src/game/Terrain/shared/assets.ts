import { RESOURCES, type ResourceId } from "game/Base/shared/resources";
import { BIOME_SETS } from "game/Terrain/shared/biomes";
import { CELL_STUDS, CHUNK_STUDS, MAP_HALF, cellAt, cellCenter, cellIndex } from "game/Terrain/shared/map";
import { fbm, simplex2, smoothstep } from "game/Terrain/shared/noise";
import { Prng } from "game/Terrain/shared/prng";
import { newColumn, PAD_FLAT, type Sampler, SITE_FLAT } from "game/Terrain/shared/sampler";

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
 * Ores: infinite deposits, one per 8-stud map cell at its centre. They come from the
 * layout's ore fields (planned once, global): a cell is ore when its centre is inside a
 * field's ragged circle, so a field can span chunks and every chunk checks the whole list.
 * Ores go first and keep props off their cells.
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
const CELLS_PER_CHUNK = CHUNK_STUDS / CELL_STUDS;
// Ores need flatter ground than props (a fraction of steepSlope), so a drill sits level.
const ORE_SLOPE = 0.4;
// Nothing is placed this close to the Core...
const LANDING_CLEAR = 40;
// ...or to a spawn's centre (a drop zone pad, or a wider enemy base site).
const PAD_CLEAR = PAD_FLAT + 8;
const SITE_CLEAR = SITE_FLAT + 8;
// Ores keep off cliff walls and mountains: below this the layout barely lifts the ground.
const ORE_WALL = 0.05;
// How far a field's ragged edge moves, in studs, and its noise scale.
const ORE_RAG = 6;
const ORE_RAG_SCALE = 12;
// Ground this far below sea level (water) is deep: no ore.
const DEEP_WATER = 3;

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

	const layout = sampler.layout;
	const core = layout.core;
	const padClear = config.mission === "attack" ? SITE_CLEAR : PAD_CLEAR;
	// Away from the Core and the spawns.
	const clear = (x: number, z: number) => {
		const cx0 = x - core.x;
		const cz0 = z - core.z;
		if (cx0 * cx0 + cz0 * cz0 < LANDING_CLEAR * LANDING_CLEAR) return false;
		for (const pad of layout.spawns) {
			const dx = x - pad.x;
			const dz = z - pad.z;
			if (dx * dx + dz * dz < padClear * padClear) return false;
		}
		return true;
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

	// Ore fields: each cell of this chunk inside a field's ragged circle becomes ore.
	const ragged = simplex2(seed, SALT_ORE);
	const gx0 = cx * CELLS_PER_CHUNK;
	const gz0 = cz * CELLS_PER_CHUNK;
	const minX = -MAP_HALF + cx * CHUNK_STUDS;
	const minZ = -MAP_HALF + cz * CHUNK_STUDS;
	for (const field of layout.oreFields) {
		const reach = field.radius + ORE_RAG;
		if (field.x + reach < minX || field.x - reach > minX + CHUNK_STUDS) continue;
		if (field.z + reach < minZ || field.z - reach > minZ + CHUNK_STUDS) continue;
		for (let i = 0; i < CELLS_PER_CHUNK; i++) {
			for (let j = 0; j < CELLS_PER_CHUNK; j++) {
				const cell = cellIndex(gx0 + i, gz0 + j);
				if (taken.has(cell)) continue;
				const position = cellCenter(cell);
				const x = position.X;
				const z = position.Z;
				const ex = x - field.x;
				const ez = z - field.z;
				const edge = field.radius + fbm(ragged, x / ORE_RAG_SCALE, z / ORE_RAG_SCALE, 2) * ORE_RAG;
				if (ex * ex + ez * ez > edge * edge) continue;
				if (!clear(x, z) || layout.wall(x, z) >= ORE_WALL || slopeAt(x, z) > steep * ORE_SLOPE) continue;
				// Deep liquid: lava anywhere below sea level, water more than DEEP_WATER under it.
				const h = height(x, z);
				if (set.liquid && h < seaLevel && (set.fluid !== Enum.Material.Water || h < seaLevel - DEEP_WATER))
					continue;
				addOre(cell, field.resource);
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
