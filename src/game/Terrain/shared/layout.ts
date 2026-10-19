import { type Archetype, ARCHETYPES, defaultConfig, type TerrainConfig } from "game/Terrain/shared/config";
import { CELL_STUDS, MAP_HALF } from "game/Terrain/shared/map";
import { fbm, type Noise2, simplex2, smoothstep } from "game/Terrain/shared/noise";
import { Prng } from "game/Terrain/shared/prng";
import { KIND_ORES, ORE_TIER, type ResourceId } from "game/Base/shared/resources";
import type { PlanetKind } from "core/Worlds/shared/star-system";

/**
 * A planet's layout: where the Core and the spawns are, the open paths between
 * them, a cliff-wall field that carves the playable area out of the map and,
 * on some archetypes, sloped mountains. Pure and deterministic in the config,
 * so every worker builds the same layout.
 *
 * The Core sits near one corner of the playable area and the spawns round the
 * opposite one, so the aliens cross the whole map and the player has to push out
 * for anything but the starter ore. Each archetype plans the waypoints of a route
 * from the Core to every spawn and the shape of its walls. The paths come from the routes,
 * warped a little. Then one rule holds for all of them: the wall is forced open
 * around the Core, the spawns and every path, so a spawn can always reach the Core.
 */

export interface Point {
	readonly x: number;
	readonly z: number;
}

export interface Layout {
	/** The resolved archetype, never "auto". */
	readonly archetype: Archetype;
	/** Studs, a multiple of `CELL_STUDS`, so the Core's 2x2 cells meet on a cell corner. */
	readonly core: Point;
	/** Drop zones (defend) or enemy base sites (attack). */
	readonly spawns: ReadonlyArray<Point>;
	/** A polyline from the Core to each spawn (same order), kept open. */
	readonly paths: ReadonlyArray<ReadonlyArray<Point>>;
	/** 0 open .. 1 blocked: the larger of `sheer` and `mountain`. Cheap: it's called for every column. */
	readonly wall: (x: number, z: number) => number;
	/** 0..1 sheer cliff walls: the playable edge and the archetype's own walls. */
	readonly sheer: (x: number, z: number) => number;
	/** 0..1 sloped mountain masses, 0 on archetypes without them. */
	readonly mountain: (x: number, z: number) => number;
	/** Ore fields, planned once: starters near the Core, then rarer ores further toward the spawns. */
	readonly oreFields: ReadonlyArray<OreField>;
	/** Derelict ruin sites: one on every covered ore field, the rest scattered in the open. */
	readonly ruins: ReadonlyArray<Ruin>;
}

/** Where a derelict ruin stands. `BaseService` fills the circle with old walls and turrets on a fresh planet. */
export interface Ruin {
	/** Studs. */
	readonly x: number;
	readonly z: number;
	readonly radius: number;
	/** Sits on a covered ore field: the ore cells under it get walled over. */
	readonly covered: boolean;
}

/** A round patch of infinite ore. Its cells are picked per chunk from the circle (with a ragged edge). */
export interface OreField {
	readonly resource: ResourceId;
	/** Studs. */
	readonly x: number;
	readonly z: number;
	readonly radius: number;
	/** Starts under derelict ruins (tier 1 and 2 only). */
	readonly covered: boolean;
}

// Distinct from the sampler's salts (2-22).
const SALT_RNG = 40;
const SALT_EDGE = 41;
const SALT_WARP = 42;
const SALT_A = 43;
const SALT_B = 44;
const SALT_WIDTH = 45;
const SALT_OUTCROP = 46;
const SALT_ORES = 47;
const SALT_RUINS = 48;

// Scattered ruins: this far from the Core, spawns and path centrelines (plus their radius), on open ground.
const RUIN_CORE_CLEAR = 120;
const RUIN_SPAWN_CLEAR = 60;
const RUIN_PATH_CLEAR = 30;
const RUIN_TRIES = 40;

// Ore fields: centres sit on open ground (wall below ORE_OPEN), off the path centrelines and clear of the spawns.
const ORE_OPEN = 0.2;
/** Only the starters sit nearer the Core than this. */
const ORE_CORE_CLEAR = 180;
const ORE_PATH_CLEAR = 14;
const ORE_SPAWN_CLEAR = 40;
/** Starter fields sit this far from the Core. */
const STARTER_MIN = 70;
const STARTER_MAX = 130;
/** Fraction of the Core to nearest-spawn distance where tier 1 starts, and tier 2 (plus TIER2_STEP per difficulty). */
const TIER1_FROM = 0.3;
const TIER2_FROM = 0.5;
const TIER2_STEP = 0.08;
const COVERED_CHANCE = 0.35;
const ORE_TRIES = 60;

/** The cliff band round the playable extent, in studs. */
const EDGE_BAND = 48;
/** How far noise shifts the boundary, and the width of its ramp. */
const EDGE_NOISE = 32;
const EDGE_RAMP = 32;

// The wall is forced to 0 within these radii, back to its natural value over OPEN_RAMP more.
const CORE_OPEN = 64;
const SPAWN_OPEN = 48;
const BASE_OPEN = 96;
const PATH_OPEN = 40;
const OPEN_RAMP = 24;

/** Paths are cut into legs this long, then each point is warped by up to PATH_WARP. */
const PATH_STEP = 64;
const PATH_WARP = 28;

/** The Core sits this far inside the playable edge (in `edgeDistance` units): about 12 cells of ground behind it. */
const CORE_INSET = 120;
/** A drop zone, and the wider enemy base site, sits this far inside it. */
const SPAWN_INSET = 130;
const SITE_INSET = 170;
/** How far the Core's corner turns off the exact diagonal, and each spawn off its place, in radians. */
const CORNER_JITTER = 0.12;
const SPAWN_JITTER = 0.06;
/** The spawns' angles off the far corner (seen from the map centre), by spawn count: spread along the far edges. */
const SPAWN_SPREAD = [[0], [-0.32, 0.32], [0, -0.55, 0.55]];

// Mountains: broad masses where a low-frequency noise peaks. They fade out over MASS_RAMP round the open zones, so they slope.
const MASS_SCALE = 420;
const MASS_FROM = 0.1;
const MASS_TO = 0.55;
const MASS_RAMP = 140;

/** Plans use these, from `layoutFor`. */
interface Ctx {
	readonly rng: Prng;
	readonly limit: number;
	/** How far inside the playable edge the spawns sit. */
	readonly spawnInset: number;
	readonly count: number;
	readonly attack: boolean;
	readonly noiseA: Noise2;
	readonly noiseB: Noise2;
	readonly noiseWidth: Noise2;
	/** 0..1 large mountain masses. */
	readonly mountains: (x: number, z: number) => number;
}

interface Segments {
	/** Distance to the nearest segment, or `math.huge` when none has the point within `reach` of its box. */
	readonly near: (x: number, z: number, reach: number) => number;
}

interface Plan {
	readonly core: Point;
	readonly spawns: Array<Point>;
	/** Waypoints Core to spawn, per spawn: both ends included. */
	readonly routes: Array<Array<Point>>;
	/** Extra open segments (decoy passes and breaches) that aren't a path. */
	readonly extras: Array<Array<Point>>;
	/** Builds the archetype's own wall (0..1), before the open zones. `spine` is the paths. */
	readonly shape: (spine: Segments) => (x: number, z: number) => number;
	/** Its mountains (0..1), before the open zones, if it has any. */
	readonly mountains?: (x: number, z: number) => number;
}

const AUTO_WEIGHTS: Record<PlanetKind, ReadonlyArray<[Archetype, number]>> = {
	Habitable: [
		["plains", 3],
		["corridor", 2],
		["split", 2],
	],
	Barren: [
		["crater", 3],
		["canyons", 2],
		["split", 2],
	],
	Frozen: [
		["islands", 3],
		["plains", 2],
		["corridor", 2],
	],
	Volcanic: [
		["canyons", 3],
		["crater", 2],
		["islands", 2],
	],
};

function snap(value: number): number {
	return math.round(value / CELL_STUDS) * CELL_STUDS;
}

function jitter(rng: Prng, amount: number): number {
	return (rng.nextNumber() * 2 - 1) * amount;
}

/** Defend: 1 drop zone (difficulty 0-1), 2 (2-3) or 3 (4). Attack: 1 enemy base, 2 at difficulty 4. */
function spawnCount(difficulty: number, attack: boolean): number {
	if (attack) return difficulty >= 4 ? 2 : 1;
	return difficulty >= 4 ? 3 : difficulty >= 2 ? 2 : 1;
}

function pickArchetype(kind: PlanetKind, roll: number): Archetype {
	const weights = AUTO_WEIGHTS[kind];
	let total = 0;
	for (const [, weight] of weights) total += weight;
	let left = roll * total;
	for (const [archetype, weight] of weights) {
		left -= weight;
		if (left < 0) return archetype;
	}
	return weights[0][0];
}

/** A flat list of segments, each with its bounding box, so a query skips most of them with four compares. */
function newSegments(lines: ReadonlyArray<ReadonlyArray<Point>>): Segments {
	const ax = new Array<number>();
	const az = new Array<number>();
	const dx = new Array<number>();
	const dz = new Array<number>();
	const inv = new Array<number>();
	const minX = new Array<number>();
	const maxX = new Array<number>();
	const minZ = new Array<number>();
	const maxZ = new Array<number>();
	for (const line of lines) {
		for (let i = 1; i < line.size(); i++) {
			const a = line[i - 1];
			const b = line[i];
			const sx = b.x - a.x;
			const sz = b.z - a.z;
			const len2 = sx * sx + sz * sz;
			ax.push(a.x);
			az.push(a.z);
			dx.push(sx);
			dz.push(sz);
			inv.push(len2 > 0 ? 1 / len2 : 0);
			minX.push(math.min(a.x, b.x));
			maxX.push(math.max(a.x, b.x));
			minZ.push(math.min(a.z, b.z));
			maxZ.push(math.max(a.z, b.z));
		}
	}
	const count = ax.size();

	return {
		near: (x, z, reach) => {
			let best = math.huge;
			for (let i = 0; i < count; i++) {
				if (x < minX[i] - reach || x > maxX[i] + reach || z < minZ[i] - reach || z > maxZ[i] + reach) continue;
				const t = math.clamp(((x - ax[i]) * dx[i] + (z - az[i]) * dz[i]) * inv[i], 0, 1);
				const ex = x - (ax[i] + dx[i] * t);
				const ez = z - (az[i] + dz[i] * t);
				const d2 = ex * ex + ez * ez;
				if (d2 < best) best = d2;
			}
			return math.sqrt(best);
		},
	};
}

/** Distance from the map centre in the norm the playable edge uses: a square with rounded-off corners. */
function edgeDistance(x: number, z: number): number {
	return 0.6 * math.max(math.abs(x), math.abs(z)) + 0.4 * math.sqrt(x * x + z * z);
}

/** The point at `angle` from the map centre that is `distance` out in `edgeDistance`, on the cell grid. */
function onEdge(angle: number, distance: number): Point {
	const x = math.cos(angle);
	const z = math.sin(angle);
	const scale = distance / edgeDistance(x, z);
	return { x: snap(x * scale), z: snap(z * scale) };
}

/** The Core near a random corner and the spawns spread round the opposite one. `angle` points from the centre to the Core. */
function corners(c: Ctx) {
	const angle = (c.rng.nextInt(4) + 0.5) * (math.pi / 2) + jitter(c.rng, CORNER_JITTER);
	const core = onEdge(angle, c.limit - CORE_INSET);
	const spawns = SPAWN_SPREAD[c.count - 1].map((offset) =>
		onEdge(angle + math.pi + offset + jitter(c.rng, SPAWN_JITTER), c.limit - c.spawnInset),
	);
	return { angle, core, spawns };
}

function direct(core: Point, spawns: ReadonlyArray<Point>): Array<Array<Point>> {
	return spawns.map((spawn) => [core, spawn]);
}

/** Open ground with a few large mountains. */
function plainsPlan(c: Ctx): Plan {
	const { core, spawns } = corners(c);
	return { core, spawns, routes: direct(core, spawns), extras: [], shape: () => () => 0, mountains: c.mountains };
}

/**
 * A ring wall round a bowl holding the Core, backed by the map edge, with a breach for every spawn and maybe
 * a decoy on the side facing the map. Mountains stand beyond it.
 */
function craterPlan(c: Ctx): Plan {
	const { angle, core, spawns } = corners(c);
	const radius = math.max(190, 0.3 * c.limit);
	const distance = (x: number, z: number) => math.sqrt((x - core.x) ** 2 + (z - core.z) ** 2);

	const extras = new Array<Array<Point>>();
	const decoys = math.min(c.rng.nextInt(2), 3 - c.count);
	for (let i = 0; i < decoys; i++) {
		const toward = angle + math.pi + jitter(c.rng, 1.1);
		const cos = math.cos(toward);
		const sin = math.sin(toward);
		extras.push([
			{ x: core.x + cos * (radius - 70), z: core.z + sin * (radius - 70) },
			{ x: core.x + cos * (radius + 70), z: core.z + sin * (radius + 70) },
		]);
	}

	return {
		core,
		spawns,
		routes: direct(core, spawns),
		extras,
		shape: () => (x, z) => {
			const r = distance(x, z);
			if (math.abs(r - radius) >= 90) return 0;
			return 1 - smoothstep(30, 62, math.abs(r - radius - fbm(c.noiseA, x / 150, z / 150, 2) * 24));
		},
		mountains: (x, z) => c.mountains(x, z) * smoothstep(radius + 60, radius + 120, distance(x, z)),
	};
}

/** A rotation of the plane by `angle`: local (u, v) to world, and back. */
function frame(angle: number) {
	const cos = math.cos(angle);
	const sin = math.sin(angle);
	return {
		world: (u: number, v: number): Point => ({ x: u * cos - v * sin, z: u * sin + v * cos }),
		u: (x: number, z: number) => x * cos + z * sin,
		v: (x: number, z: number) => -x * sin + z * cos,
	};
}

/** A long winding band: the Core at one end, the spawns at the far end, where the band forks. */
function corridorPlan(c: Ctx): Plan {
	const { angle, core, spawns } = corners(c);
	// u runs from the Core's corner to the far one.
	const f = frame(angle + math.pi);
	const L = c.limit;
	const u0 = f.u(core.x, core.z);

	const amplitude = 0.28 * L * (0.7 + 0.3 * c.rng.nextNumber());
	const wavelength = L * (1.1 + 0.6 * c.rng.nextNumber());
	const phase = c.rng.nextNumber() * 2 * math.pi;
	const weave = (u: number) =>
		amplitude * smoothstep(u0, u0 + 0.4 * L, u) * math.sin((2 * math.pi * (u - u0)) / wavelength + phase);
	// Where the trunk forks toward the spawns: part way to the nearest of them.
	let nearU = math.huge;
	for (const spawn of spawns) nearU = math.min(nearU, f.u(spawn.x, spawn.z));
	const fork = u0 + (nearU - u0) * (0.6 + 0.15 * c.rng.nextNumber());

	const routes = spawns.map((spawn) => {
		const su = f.u(spawn.x, spawn.z);
		const sv = f.v(spawn.x, spawn.z);
		const route = [core];
		const steps = math.ceil((su - u0) / PATH_STEP);
		for (let i = 1; i < steps; i++) {
			const u = u0 + ((su - u0) * i) / steps;
			const blend = smoothstep(fork, su, u);
			route.push(f.world(u, weave(u) * (1 - blend) + sv * blend));
		}
		route.push(spawn);
		return route;
	});

	return {
		core,
		spawns,
		routes,
		extras: [],
		shape: (spine) => (x, z) => {
			const distance = spine.near(x, z, 140);
			if (distance >= 140) return 1;
			// Chambers where a low-frequency noise peaks, and a little width wobble.
			const chamber = smoothstep(0.2, 0.55, fbm(c.noiseA, x / 260, z / 260, 2));
			const half = 56 + 26 * chamber + 12 * c.noiseWidth(x / 120, z / 120);
			return smoothstep(half, half + 44, distance);
		},
	};
}

/**
 * One or two ridges across the map between the Core's corner and the far one, each crossed by the paths at
 * a pass, plus decoy passes.
 */
function splitPlan(c: Ctx): Plan {
	const { angle, core, spawns } = corners(c);
	// u runs from the Core's corner to the far one.
	const f = frame(angle + math.pi);
	const L = c.limit;
	const coreU = f.u(core.x, core.z);
	const coreV = f.v(core.x, core.z);
	let nearU = math.huge;
	for (const spawn of spawns) nearU = math.min(nearU, f.u(spawn.x, spawn.z));
	const span = nearU - coreU;

	const ridgeCount = c.count === 3 ? 2 : 1 + c.rng.nextInt(2);
	const bases =
		ridgeCount === 1
			? [coreU + span * (0.5 + jitter(c.rng, 0.05))]
			: [coreU + span * (0.35 + jitter(c.rng, 0.03)), coreU + span * (0.68 + jitter(c.rng, 0.03))];
	const ridgeU = (k: number, v: number) => bases[k] + 40 * fbm(c.noiseA, v / 280 + 13.7 * k, 5.1 * k + 3.3, 2);

	// Every ridge is between the Core and each spawn, so each route crosses them all, nearest first.
	const routes = spawns.map((spawn) => {
		const su = f.u(spawn.x, spawn.z);
		const sv = f.v(spawn.x, spawn.z);
		const route = [core];
		for (let k = 0; k < ridgeCount; k++) {
			const t = (bases[k] - coreU) / (su - coreU);
			const v = math.clamp(coreV + (sv - coreV) * t + jitter(c.rng, 0.08 * L), -0.4 * L, 0.4 * L);
			route.push(f.world(ridgeU(k, v), v));
		}
		route.push(spawn);
		return route;
	});

	// Decoy passes, so the ridges aren't only broken where the paths cross.
	const extras = new Array<Array<Point>>();
	for (let k = 0; k < ridgeCount; k++) {
		const passes = 1 + c.rng.nextInt(2);
		for (let i = 0; i < passes; i++) {
			const v = jitter(c.rng, 0.4 * L);
			extras.push([f.world(ridgeU(k, v) - 100, v), f.world(ridgeU(k, v) + 100, v)]);
		}
	}

	return {
		core,
		spawns,
		routes,
		extras,
		shape: () => (x, z) => {
			const u = f.u(x, z);
			const v = f.v(x, z);
			let wall = 0;
			for (let k = 0; k < ridgeCount; k++) {
				if (math.abs(u - bases[k]) > 130) continue;
				wall = math.max(wall, 1 - smoothstep(28, 60, math.abs(u - ridgeU(k, v))));
			}
			return wall;
		},
	};
}

/** Plateaus joined by narrow land bridges: a chain of islands from the Core to each spawn, plus decoys. */
function islandsPlan(c: Ctx): Plan {
	const { angle, core, spawns } = corners(c);
	const ix = [core.x];
	const iz = [core.z];
	const ir = [130];
	const routes = new Array<Array<Point>>();

	for (const spawn of spawns) {
		ix.push(spawn.x);
		iz.push(spawn.z);
		ir.push(c.attack ? 150 : 105);
		const route = [core];
		const mids = 1 + c.rng.nextInt(2);
		const dx = spawn.x - core.x;
		const dz = spawn.z - core.z;
		const length = math.sqrt(dx * dx + dz * dz);
		for (let m = 1; m <= mids; m++) {
			const t = m / (mids + 1);
			const side = jitter(c.rng, 0.15 * length);
			const x = core.x + dx * t - (dz / length) * side;
			const z = core.z + dz * t + (dx / length) * side;
			route.push({ x, z });
			ix.push(x);
			iz.push(z);
			ir.push(70 + 25 * c.rng.nextNumber());
		}
		route.push(spawn);
		routes.push(route);
	}

	// Decoy islands toward the far side, inside the edge, each bridged to the nearest island.
	const across = math.sqrt((spawns[0].x - core.x) ** 2 + (spawns[0].z - core.z) ** 2);
	const extras = new Array<Array<Point>>();
	const decoys = 2 + c.rng.nextInt(2);
	for (let i = 0; i < decoys; i++) {
		for (let attempt = 0; attempt < 12; attempt++) {
			const toward = angle + math.pi + jitter(c.rng, 1.1);
			const radius = across * (0.25 + 0.55 * c.rng.nextNumber());
			const x = core.x + math.cos(toward) * radius;
			const z = core.z + math.sin(toward) * radius;
			if (edgeDistance(x, z) > c.limit - 80) continue;
			let nearest = 0;
			let best = math.huge;
			for (let j = 0; j < ix.size(); j++) {
				const d = math.sqrt((x - ix[j]) ** 2 + (z - iz[j]) ** 2);
				if (d < best) {
					best = d;
					nearest = j;
				}
			}
			if (best < 140) continue;
			extras.push([
				{ x, z },
				{ x: ix[nearest], z: iz[nearest] },
			]);
			ix.push(x);
			iz.push(z);
			ir.push(55 + 25 * c.rng.nextNumber());
			break;
		}
	}

	const count = ix.size();
	return {
		core,
		spawns,
		routes,
		extras,
		shape: () => (x, z) => {
			// One noise value shared by every island's edge, so neighbours blend.
			const n = fbm(c.noiseA, x / 140, z / 140, 2) * 16;
			let open = 0;
			for (let i = 0; i < count; i++) {
				const ex = x - ix[i];
				const ez = z - iz[i];
				const r = ir[i];
				if (math.abs(ex) > r + 30 || math.abs(ez) > r + 30) continue;
				open = math.max(open, 1 - smoothstep(r - 14, r + 6, math.sqrt(ex * ex + ez * ez) + n));
			}
			return 1 - open;
		},
	};
}

/** A maze of narrow channels: the zero lines of two warped noises, crossing each other. */
function canyonsPlan(c: Ctx): Plan {
	const { core, spawns } = corners(c);
	const scale = 1 / 320;
	return {
		core,
		spawns,
		routes: direct(core, spawns),
		extras: [],
		shape: () => (x, z) => {
			const wx = (x + fbm(c.noiseWidth, x * 0.004, z * 0.004, 2) * 70) * scale;
			const wz = (z + fbm(c.noiseWidth, x * 0.004 + 19, z * 0.004 - 7, 2) * 70) * scale;
			// |noise| is about 2.5 per unit near a zero line, so this is a channel half-width of 20-34 studs.
			const half = (20 + 14 * (c.noiseWidth(x / 500 + 3.1, z / 500) * 0.5 + 0.5)) * 2.5 * scale;
			const a = 1 - smoothstep(half * 0.7, half, math.abs(c.noiseA(wx, wz)));
			const b = 1 - smoothstep(half * 0.7, half, math.abs(c.noiseB(wx, wz)));
			return 1 - math.max(a, b);
		},
	};
}

const PLANNERS: Record<Archetype, (c: Ctx) => Plan> = {
	plains: plainsPlan,
	corridor: corridorPlan,
	crater: craterPlan,
	split: splitPlan,
	islands: islandsPlan,
	canyons: canyonsPlan,
};

/**
 * Plans the ore fields by rejection sampling (bounded tries, so a cramped map just
 * gets fewer). Tier comes from how far a point is along the Core to nearest-spawn
 * axis; harder planets push tier 2 further out and have fewer of those fields.
 */
function planOre(
	config: TerrainConfig,
	core: Point,
	spawns: ReadonlyArray<Point>,
	limit: number,
	wall: (x: number, z: number) => number,
	centrelines: Segments,
): Array<OreField> {
	const rng = new Prng(config.seed, SALT_ORES);
	const ores = KIND_ORES[config.kind];
	const tier2From = TIER2_FROM + TIER2_STEP * config.difficulty;
	const tier2Cap = math.max(1, 3 - math.floor(config.difficulty / 2));
	const fields = new Array<OreField>();
	let tier2Count = 0;

	/** Where `x, z` sits between the Core (0) and its nearest spawn (1). */
	const along = (x: number, z: number): number => {
		let best = math.huge;
		let f = 0;
		for (const spawn of spawns) {
			const ax = spawn.x - core.x;
			const az = spawn.z - core.z;
			const d = (x - spawn.x) ** 2 + (z - spawn.z) ** 2;
			if (d < best) {
				best = d;
				f = ((x - core.x) * ax + (z - core.z) * az) / (ax * ax + az * az);
			}
		}
		return f;
	};

	/** Whether a field of `radius` at (x, z) is on open ground, off the paths and spawns, and clear of the other fields. */
	const fits = (x: number, z: number, radius: number): boolean => {
		if (math.max(math.abs(x), math.abs(z)) > limit || wall(x, z) >= ORE_OPEN) return false;
		if (centrelines.near(x, z, ORE_PATH_CLEAR) < ORE_PATH_CLEAR) return false;
		for (const spawn of spawns) {
			if ((x - spawn.x) ** 2 + (z - spawn.z) ** 2 < (ORE_SPAWN_CLEAR + radius) ** 2) return false;
		}
		for (const other of fields) {
			if ((x - other.x) ** 2 + (z - other.z) ** 2 < (0.9 * (radius + other.radius)) ** 2) return false;
		}
		return true;
	};

	const add = (resource: ResourceId, x: number, z: number, radius: number) => {
		const tier = ORE_TIER[resource] ?? 0;
		if (tier === 2) tier2Count++;
		fields.push({ resource, x, z, radius, covered: tier > 0 && rng.nextNumber() < COVERED_CHANCE });
	};

	// Starters: copper and lead, on opposite-ish sides of the Core.
	const start = rng.nextNumber() * 2 * math.pi;
	const starters: ReadonlyArray<ResourceId> = ["copper", "lead"];
	starters.forEach((resource, i) => {
		const radius = 24 + 10 * rng.nextNumber();
		let bestX = core.x;
		let bestZ = core.z;
		let bestWall = math.huge;
		for (let attempt = 0; attempt < 4 * ORE_TRIES; attempt++) {
			const a = start + i * math.pi + (rng.nextNumber() - 0.5) * 2 + attempt * 0.7;
			const r = STARTER_MIN + (STARTER_MAX - STARTER_MIN) * rng.nextNumber();
			const x = core.x + math.cos(a) * r;
			const z = core.z + math.sin(a) * r;
			if (fits(x, z, radius)) {
				add(resource, x, z, radius);
				return;
			}
			const w = wall(x, z);
			if (w < bestWall) {
				bestWall = w;
				bestX = x;
				bestZ = z;
			}
		}
		// ponytail: no open spot found, so the least walled try stands (checkLayouts flags it).
		add(resource, bestX, bestZ, radius);
	});

	/** Tries to place one field. `want2` forces a tier-2 field, so the candidate runs from its threshold along an axis. */
	const place = (want2: boolean): void => {
		for (let attempt = 0; attempt < ORE_TRIES; attempt++) {
			let x: number;
			let z: number;
			if (want2 || rng.nextNumber() < 0.75) {
				const spawn = spawns[rng.nextInt(spawns.size())];
				const ax = spawn.x - core.x;
				const az = spawn.z - core.z;
				const length = math.sqrt(ax * ax + az * az);
				const t = want2 ? tier2From + 0.02 + (0.95 - tier2From) * rng.nextNumber() : rng.nextNumber();
				const side = (rng.nextNumber() * 2 - 1) * 0.4 * length;
				x = core.x + ax * t - (az / length) * side;
				z = core.z + az * t + (ax / length) * side;
			} else {
				x = (rng.nextNumber() * 2 - 1) * limit;
				z = (rng.nextNumber() * 2 - 1) * limit;
			}
			if ((x - core.x) ** 2 + (z - core.z) ** 2 < ORE_CORE_CLEAR ** 2) continue;

			const f = along(x, z);
			// Tiers this point allows, and the weights of the ores in them. Common ores weigh less once the starters are down.
			const weights = ores.map((ore) => {
				const tier = ORE_TIER[ore.resource] ?? 0;
				if (want2) return tier === 2 ? ore.weight : 0;
				if (tier === 1 && f < TIER1_FROM) return 0;
				if (tier === 2) {
					if (f < tier2From || tier2Count >= tier2Cap) return 0;
					return ore.weight * (1 - 0.15 * config.difficulty);
				}
				return tier === 0 ? ore.weight * 0.5 : ore.weight;
			});
			let total = 0;
			for (const w of weights) total += w;
			if (total <= 0) continue;
			let roll = rng.nextNumber() * total;
			let pick = 0;
			for (let i = 0; i < weights.size(); i++) {
				roll -= weights[i];
				if (roll < 0) {
					pick = i;
					break;
				}
			}
			const resource = ores[pick].resource;
			const tier = ORE_TIER[resource] ?? 0;
			// Rarer fields are smaller: 16-28 for tier 2, 22-40 otherwise.
			const radius = tier === 2 ? 16 + 12 * rng.nextNumber() : 22 + 18 * rng.nextNumber();
			if (fits(x, z, radius)) {
				add(resource, x, z, radius);
				return;
			}
		}
	};

	const area = config.mapScale * config.mapScale;
	const count = math.round((4 + 6 * config.oreDensity) * area);
	for (let i = 0; i < count; i++) place(false);

	let hasTier2 = false;
	for (const ore of ores) if (ORE_TIER[ore.resource] === 2) hasTier2 = true;
	if (hasTier2 && tier2Count === 0) place(true);

	return fields;
}

/** One ruin on every covered ore field, then 3-8 more (more on higher difficulty) in the open, clear of the Core, spawns and paths. */
function planRuins(
	config: TerrainConfig,
	core: Point,
	spawns: ReadonlyArray<Point>,
	limit: number,
	wall: (x: number, z: number) => number,
	centrelines: Segments,
	fields: ReadonlyArray<OreField>,
): Array<Ruin> {
	const rng = new Prng(config.seed, SALT_RUINS);
	const ruins = new Array<Ruin>();
	for (const field of fields) {
		if (field.covered) ruins.push({ x: field.x, z: field.z, radius: field.radius + 6, covered: true });
	}
	const scattered = math.min(8, 3 + config.difficulty + rng.nextInt(2));
	for (let i = 0; i < scattered; i++) {
		for (let attempt = 0; attempt < RUIN_TRIES; attempt++) {
			const radius = 14 + 10 * rng.nextNumber();
			const x = (rng.nextNumber() * 2 - 1) * limit;
			const z = (rng.nextNumber() * 2 - 1) * limit;
			if (wall(x, z) >= ORE_OPEN || centrelines.near(x, z, RUIN_PATH_CLEAR + radius) < RUIN_PATH_CLEAR + radius)
				continue;
			if ((x - core.x) ** 2 + (z - core.z) ** 2 < (RUIN_CORE_CLEAR + radius) ** 2) continue;
			if (spawns.some((s) => (x - s.x) ** 2 + (z - s.z) ** 2 < (RUIN_SPAWN_CLEAR + radius) ** 2)) continue;
			if (ruins.some((r) => (x - r.x) ** 2 + (z - r.z) ** 2 < (r.radius + radius) ** 2)) continue;
			ruins.push({ x, z, radius, covered: false });
			break;
		}
	}
	return ruins;
}

export function layoutFor(config: TerrainConfig): Layout {
	const seed = config.seed;
	const attack = config.mission === "attack";
	const rng = new Prng(seed, SALT_RNG);
	// Always rolled, so the rest of the stream doesn't shift with "auto".
	const roll = rng.nextNumber();
	const archetype = config.archetype === "auto" ? pickArchetype(config.kind, roll) : config.archetype;

	const noiseA = simplex2(seed, SALT_A);
	const noiseWidth = simplex2(seed, SALT_WIDTH);
	const noiseOutcrop = simplex2(seed, SALT_OUTCROP);
	const edgeNoise = simplex2(seed, SALT_EDGE);
	const warpNoise = simplex2(seed, SALT_WARP);

	// Walls are 1 beyond this, in `edgeDistance` units.
	const limit = MAP_HALF * config.mapScale - EDGE_BAND;
	const ctx: Ctx = {
		rng,
		limit,
		spawnInset: attack ? SITE_INSET : SPAWN_INSET,
		count: spawnCount(config.difficulty, attack),
		attack,
		noiseA,
		noiseB: simplex2(seed, SALT_B),
		noiseWidth,
		mountains: (x, z) => smoothstep(MASS_FROM, MASS_TO, fbm(noiseOutcrop, x / MASS_SCALE, z / MASS_SCALE, 3)),
	};
	const plan = PLANNERS[archetype](ctx);

	// Cut each route into short legs and warp the points between its ends.
	const paths = plan.routes.map((route) => {
		const out = [route[0]];
		for (let i = 1; i < route.size(); i++) {
			const a = route[i - 1];
			const b = route[i];
			const legs = math.max(1, math.ceil(math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2) / PATH_STEP));
			for (let s = 1; s <= legs; s++) {
				const t = s / legs;
				// The last leg ends exactly on `b`, not on a rounding of it.
				let x = s === legs ? b.x : a.x + (b.x - a.x) * t;
				let z = s === legs ? b.z : a.z + (b.z - a.z) * t;
				if (i < route.size() - 1 || s < legs) {
					const wx = x + fbm(warpNoise, x / 220, z / 220, 2) * PATH_WARP;
					const wz = z + fbm(warpNoise, x / 220 + 31.4, z / 220 - 17.9, 2) * PATH_WARP;
					// Never warp a point out toward the boundary.
					if (edgeDistance(wx, wz) <= limit - 40) {
						x = wx;
						z = wz;
					}
				}
				out.push({ x, z });
			}
		}
		return out;
	});

	const shape = plan.shape(newSegments(paths));
	const open = newSegments([...paths, ...plan.extras]);
	const core = plan.core;
	const spawns = plan.spawns;
	const spawnOpen = attack ? BASE_OPEN : SPAWN_OPEN;

	/** 1 far from the Core, the spawns and the paths, 0 inside their open zones, back to 1 over `ramp` more. */
	const openFactor = (x: number, z: number, ramp: number): number => {
		let factor = 1;
		const cx = x - core.x;
		const cz = z - core.z;
		if (math.abs(cx) < CORE_OPEN + ramp && math.abs(cz) < CORE_OPEN + ramp) {
			factor = smoothstep(CORE_OPEN, CORE_OPEN + ramp, math.sqrt(cx * cx + cz * cz));
		}
		for (const spawn of spawns) {
			const sx = x - spawn.x;
			const sz = z - spawn.z;
			if (math.abs(sx) < spawnOpen + ramp && math.abs(sz) < spawnOpen + ramp) {
				factor = math.min(factor, smoothstep(spawnOpen, spawnOpen + ramp, math.sqrt(sx * sx + sz * sz)));
			}
		}
		const distance = open.near(x, z, PATH_OPEN + ramp);
		if (distance < PATH_OPEN + ramp) factor = math.min(factor, smoothstep(PATH_OPEN, PATH_OPEN + ramp, distance));
		return factor;
	};

	const sheer = (x: number, z: number): number => {
		let edge = 0;
		// Noise moves the boundary by at most EDGE_NOISE, so well inside it there's nothing to compute.
		const d = edgeDistance(x, z);
		if (d > limit - EDGE_NOISE - EDGE_RAMP) {
			edge = smoothstep(limit - EDGE_RAMP, limit, d + fbm(edgeNoise, x / 180, z / 180, 2) * EDGE_NOISE);
			if (edge >= 1) return 1;
		}
		const s = shape(x, z);
		if (s <= 0) return edge;
		return math.max(edge, s * openFactor(x, z, OPEN_RAMP));
	};

	// Mountains fade out over a wider ramp than the cliffs, so the ground climbs into them.
	const masses = plan.mountains;
	const mountain = (x: number, z: number): number => {
		if (!masses) return 0;
		const m = masses(x, z);
		return m <= 0 ? 0 : m * openFactor(x, z, MASS_RAMP);
	};
	const wall = masses ? (x: number, z: number) => math.max(sheer(x, z), mountain(x, z)) : sheer;

	const oreFields = planOre(config, core, spawns, limit, wall, newSegments(paths));

	const ruins = planRuins(config, core, spawns, limit, wall, newSegments(paths), oreFields);

	return { archetype, core, spawns, paths, wall, sheer, mountain, oreFields, ruins };
}

/**
 * Self-check for the debug panel or Studio, not run at import: 20 seeds of every
 * archetype across kinds, difficulties, missions and map scales. Errors on the
 * first broken layout.
 */
export function checkLayouts(): void {
	const kinds: ReadonlyArray<PlanetKind> = ["Habitable", "Barren", "Frozen", "Volcanic"];
	for (const archetype of ARCHETYPES) {
		for (let i = 0; i < 20; i++) {
			const config: TerrainConfig = {
				...defaultConfig(),
				seed: 1000 + i * 7919,
				kind: kinds[i % kinds.size()],
				archetype,
				difficulty: i % 5,
				mission: i % 2 === 0 ? "defend" : "attack",
				mapScale: 0.6 + (i % 5) * 0.1,
			};
			const layout = layoutFor(config);
			const name = `${archetype} seed ${config.seed} (difficulty ${config.difficulty}, ${config.mission}, scale ${config.mapScale})`;
			const extent = MAP_HALF * config.mapScale - EDGE_BAND;

			const check = (point: Point, what: string) => {
				assert(
					layout.wall(point.x, point.z) < 0.1,
					`${name}: ${what} is walled in at (${point.x}, ${point.z})`,
				);
				assert(
					math.max(math.abs(point.x), math.abs(point.z)) <= extent,
					`${name}: ${what} is outside the extent at (${point.x}, ${point.z})`,
				);
			};

			assert(layout.archetype === archetype, `${name}: resolved to ${layout.archetype}`);
			assert(
				layout.core.x % CELL_STUDS === 0 && layout.core.z % CELL_STUDS === 0,
				`${name}: Core is off the cell grid`,
			);
			check(layout.core, "the Core");
			assert(
				layout.spawns.size() === spawnCount(config.difficulty, config.mission === "attack"),
				`${name}: wrong spawn count`,
			);
			assert(layout.paths.size() === layout.spawns.size(), `${name}: a spawn has no path`);
			layout.spawns.forEach((spawn, index) => {
				check(spawn, "a spawn");
				const across = math.sqrt((spawn.x - layout.core.x) ** 2 + (spawn.z - layout.core.z) ** 2);
				assert(across >= extent, `${name}: spawn ${index} is only ${math.floor(across)} studs from the Core`);
				const path = layout.paths[index];
				const last = path[path.size() - 1];
				assert(last.x === spawn.x && last.z === spawn.z, `${name}: path ${index} doesn't end at its spawn`);
				for (const point of path) check(point, `path ${index}`);
			});

			let starters = 0;
			for (const field of layout.oreFields) {
				assert(layout.wall(field.x, field.z) < 0.2, `${name}: ore field ${field.resource} is on a wall`);
				const dx = field.x - layout.core.x;
				const dz = field.z - layout.core.z;
				if (dx * dx + dz * dz <= 130 * 130 && (field.resource === "copper" || field.resource === "lead")) {
					starters++;
				}
			}
			assert(starters >= 2, `${name}: ${starters} starter ore fields within 130 studs of the Core`);
		}
	}
}
