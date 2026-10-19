import { DIRECTIONS, directionOf } from "game/Base/shared/belts";
import { BUILDINGS, type BuildingKind, CORES, isBelt, isCore, isPowered, linkReach } from "game/Base/shared/buildings";
import type { ResourceId } from "game/Base/shared/resources";
import type { PlanetMap } from "game/Terrain/server/planet-map";
import type { Point } from "game/Terrain/shared/layout";
import { CELL_STUDS, cellCoords, cellIndex, GRID_SIZE, MAP_HALF } from "game/Terrain/shared/map";
import { Prng } from "game/Terrain/shared/prng";

/*
 * Plans an enemy base round an attack site, as plain data: no building is made here (`BaseService`
 * does that, on the "enemy" team, then applies the links). Everything is a pure function of the map,
 * the site, the difficulty and the seed, and follows the placement rules players get: no cliff or
 * deep liquid, no steep ground (belts excepted), nothing overlapping. The drop-zone rule is skipped,
 * as the site is one.
 *
 * Logistics, the way `LogisticsService` runs them: a drill hands ore to any neighbour that takes it,
 * a belt only to what is in front of it, a router to every side but the one it came from. So:
 * - A hub is a Router (or a Graphite Press) with up to three buildings touching it, and one belt
 *   feeding it from behind. The belt runs back to a drill on the ore the hub's buildings fire or burn.
 * - Core lines are drills and belts ending in the Core, any ore.
 * - Lines never touch: a belt beside another line's drill, router or press would be fed its ore and
 *   clog (a turret refuses what it can't use). `clashes` keeps them apart.
 * - A line crosses another by hopping its belt, which becomes a Junction (see `hoppable`), and crosses
 *   the wall ring straight, so the ring stays whole but for its gaps and where a belt passes.
 * Unloaders are never used: they find nothing in a non-player Core.
 */

/** One building to make: its -X/-Z corner cell, rotation (see `DIRECTIONS`) and the cells of the buildings it is power-linked to. */
export interface EnemyBuilding {
	readonly kind: BuildingKind;
	readonly cell: number;
	readonly rotation: number;
	/** Cells of buildings this one links to. Each link is listed once, on a node. Apply them after every building is made. */
	readonly links: Array<number>;
}

/** Most height difference across a footprint, in studs. Keep in step with `BaseService`. */
export const PLACE_MAX_SLOPE = 6;

const SALT = 70;
/** Studs from the Core's middle (the Chebyshev way) to the wall ring: a square, one cell thick. */
const RING = 72;
/** The lane out of each wall gap is this many studs either side of its axis, and stays free of anything solid. */
const LANE_HALF = 12;
/** Cells either side of the Core that are looked at. */
const SPAN = 12;
/** How far belts search for ore, in cells from the Core. */
const SEARCH = 48;
/** Hubs sit at least this many cells apart. */
const HUB_SPACING = 4;
/** Hub spots tried, with a route, before the nest is skipped. */
const HUB_TRIES = 12;
const CORE_LINE = 0;

type Family = "copper" | "lead" | "graphite" | "thorium" | "titanium";
type Slots = Partial<Record<"left" | "front" | "right", BuildingKind>>;

/**
 * What a nest fires, by the ore its belt carries: the turrets that take it, each with the difficulty
 * it appears at, weakest first. Graphite has no ore: coal goes through a Graphite Press the turrets touch.
 */
const FAMILIES: Record<
	Family,
	{
		readonly ore: ResourceId;
		readonly press?: true;
		readonly turrets: ReadonlyArray<readonly [BuildingKind, number]>;
	}
> = {
	copper: {
		ore: "copper",
		turrets: [
			["turret", 0],
			["autoTurret", 1],
			["vulcan", 2],
			["salvo", 2],
			["fuse", 3],
		],
	},
	lead: { ore: "lead", turrets: [["scatter", 1]] },
	graphite: {
		ore: "coal",
		press: true,
		turrets: [
			["hail", 2],
			["cannon", 3],
			["ripple", 3],
			["reaper", 4],
		],
	},
	thorium: {
		ore: "thorium",
		turrets: [
			["ripple", 3],
			["fuse", 3],
			["reaper", 4],
			["harbinger", 4],
		],
	},
	titanium: {
		ore: "titanium",
		turrets: [
			["scatter", 1],
			["harbinger", 4],
		],
	},
};

/** The nests of each difficulty, in order, as the family each would like. A missing ore falls back down `FALLBACK`. */
const NESTS: ReadonlyArray<ReadonlyArray<Family>> = [
	["copper", "copper"],
	["copper", "lead", "copper"],
	["copper", "graphite", "lead", "copper"],
	["copper", "graphite", "lead", "thorium", "copper"],
	["thorium", "graphite", "titanium", "lead", "copper", "copper"],
];
const FALLBACK: ReadonlyArray<Family> = ["copper", "lead", "graphite", "thorium", "titanium"];

/** Ores the Core is given drills for, most useful first. */
const OUTPOSTS: ReadonlyArray<ResourceId> = ["copper", "lead", "titanium", "coal", "sand", "scrap", "thorium"];

type Step = readonly [gx: number, gz: number, rotation: number];
interface Route {
	/** From beside the drill to the end: each faces the next, the last the hub or Core. */
	readonly belts: Array<Step>;
	readonly drill: readonly [number, number];
	/** Belts of other lines it crosses, each to become a Junction. */
	readonly junctions: Array<number>;
}

class Planner {
	readonly out = new Array<EnemyBuilding>();
	private readonly rng: Prng;
	/** Cells with a building on them. */
	private readonly occ = new Set<number>();
	/** Cells kept clear of anything solid: the lanes out of the wall gaps. Belts may cross. */
	private readonly keep = new Set<number>();
	/** Which line each belt is on, and each drill, router and press (whatever hands ore on to its neighbours). */
	private readonly belts = new Map<number, number>();
	/** Where in `out` each belt is, to swap one for a Junction. */
	private readonly beltAt = new Map<number, number>();
	private readonly hot = new Map<number, number>();
	private readonly ground = new Map<number, boolean>();
	private readonly flats = new Map<number, boolean>();
	private readonly ores = new Map<number, ResourceId>();
	private readonly nearOres = new Set<ResourceId>();
	private readonly coreRing = new Set<number>();
	private readonly hubs = new Array<readonly [number, number]>();
	private nextLine = 1;
	/** Ores a Core line has been laid for. */
	private readonly made = new Array<ResourceId>();
	/** The Core's middle in cells (of its -X/-Z corner) and studs. */
	private ogx = 0;
	private ogz = 0;
	private ox = 0;
	private oz = 0;
	/** The side of the Core facing the player's, and the second gap's side. */
	private face = 0;
	private gap = 0;

	constructor(
		private readonly map: PlanetMap,
		private readonly site: Point,
		private readonly difficulty: number,
		seed: number,
	) {
		this.rng = new Prng(seed, SALT);
	}

	plan(): Array<EnemyBuilding> {
		this.placeCore();
		for (const deposit of this.map.ores) {
			this.ores.set(deposit.cell, deposit.resource);
			const [gx, gz] = cellCoords(deposit.cell);
			if (math.max(math.abs(gx - this.ogx), math.abs(gz - this.ogz)) <= SEARCH)
				this.nearOres.add(deposit.resource);
		}
		// The Core has one line before anything can crowd it out; the rest come last.
		this.outposts(1);
		const nests = NESTS[this.difficulty];
		// Two nests, then power, so the generators get room, then the rest.
		nests.forEach((want, i) => i < 2 && this.nest(want));
		this.power();
		nests.forEach((want, i) => i >= 2 && this.nest(want));
		this.outposts(math.min(2 + this.difficulty, 6));
		this.linkPower();
		this.walls();
		return this.out;
	}

	// Grid

	private put(kind: BuildingKind, gx: number, gz: number, rotation: number, line = CORE_LINE) {
		this.out.push({ kind, cell: cellIndex(gx, gz), rotation, links: [] });
		const size = BUILDINGS[kind].size;
		for (let dz = 0; dz < size; dz++) {
			for (let dx = 0; dx < size; dx++) {
				const cell = cellIndex(gx + dx, gz + dz);
				this.occ.add(cell);
				if (isBelt(kind)) {
					this.belts.set(cell, line);
					this.beltAt.set(cell, this.out.size() - 1);
				} else if (BUILDINGS[kind].outputs) this.hot.set(cell, line);
			}
		}
	}

	/** Takes back everything put after `mark` buildings. */
	private rollback(mark: number) {
		while (this.out.size() > mark) {
			const { kind, cell } = this.out.pop()!;
			const [gx, gz] = cellCoords(cell);
			const size = BUILDINGS[kind].size;
			for (let dz = 0; dz < size; dz++) {
				for (let dx = 0; dx < size; dx++) {
					const covered = cellIndex(gx + dx, gz + dz);
					this.occ.delete(covered);
					this.belts.delete(covered);
					this.beltAt.delete(covered);
					this.hot.delete(covered);
				}
			}
		}
	}

	private studs(gx: number, gz: number): [x: number, z: number] {
		return [-MAP_HALF + (gx + 0.5) * CELL_STUDS, -MAP_HALF + (gz + 0.5) * CELL_STUDS];
	}

	/** A cell's centre, from the Core's middle, in studs. */
	private rel(gx: number, gz: number): [dx: number, dz: number] {
		const [x, z] = this.studs(gx, gz);
		return [x - this.ox, z - this.oz];
	}

	/** Studs from the Core's middle, the Chebyshev way. */
	private cheb(gx: number, gz: number): number {
		const [dx, dz] = this.rel(gx, gz);
		return math.max(math.abs(dx), math.abs(dz));
	}

	/** Whether a `size`×`size` block is inside the wall ring. */
	private inside(gx: number, gz: number, size: number): boolean {
		const far = size - 1;
		return (
			this.cheb(gx, gz) <= RING - 4 &&
			this.cheb(gx + far, gz) <= RING - 4 &&
			this.cheb(gx, gz + far) <= RING - 4 &&
			this.cheb(gx + far, gz + far) <= RING - 4
		);
	}

	/** Whether a cell is on the wall ring. */
	private onRing(gx: number, gz: number): boolean {
		const d = this.cheb(gx, gz);
		return d > RING - 4 && d <= RING + 4;
	}

	/** Whether the ground there is neither cliff nor deep liquid. */
	private buildable(cell: number): boolean {
		let ok = this.ground.get(cell);
		if (ok === undefined) {
			const [gx, gz] = cellCoords(cell);
			const [x, z] = this.studs(gx, gz);
			ok = !this.map.cliff(cell) && !this.map.isDeep(x, z);
			this.ground.set(cell, ok);
		}
		return ok;
	}

	private flat(cell: number, size: number): boolean {
		const key = cell * 8 + size;
		let ok = this.flats.get(key);
		if (ok === undefined) {
			const [low, high] = this.map.groundRange(cell, size);
			ok = high - low <= PLACE_MAX_SLOPE;
			this.flats.set(key, ok);
		}
		return ok;
	}

	/** `BaseService.placeOne`'s rules for a `kind` with its corner on (gx, gz), and occupancy. `bounded` keeps it inside the ring. */
	private fits(kind: BuildingKind, gx: number, gz: number, bounded: boolean): boolean {
		const size = BUILDINGS[kind].size;
		if (gx < 1 || gz < 1 || gx + size > GRID_SIZE - 1 || gz + size > GRID_SIZE - 1) return false;
		const solid = !isBelt(kind);
		if (solid && bounded && !this.inside(gx, gz, size)) return false;
		for (let dz = 0; dz < size; dz++) {
			for (let dx = 0; dx < size; dx++) {
				const cell = cellIndex(gx + dx, gz + dz);
				if (this.occ.has(cell) || (solid && this.keep.has(cell)) || !this.buildable(cell)) return false;
			}
		}
		return !solid || this.flat(cellIndex(gx, gz), size);
	}

	/**
	 * Whether a block of a `line` would be touching another line's ore: a belt beside another line's
	 * drill, router or press, or one of those beside another line's belt or hot block. Only the Core's
	 * lines may touch the Core with a hot block, or they'd feed it from a nest's line.
	 */
	private clashes(gx: number, gz: number, size: number, line: number, hot: boolean): boolean {
		for (let dz = 0; dz < size; dz++) {
			for (let dx = 0; dx < size; dx++) {
				if (hot && line !== CORE_LINE && this.coreRing.has(cellIndex(gx + dx, gz + dz))) return true;
				for (const [sx, sz] of DIRECTIONS) {
					const nx = gx + dx + sx;
					const nz = gz + dz + sz;
					if (nx >= gx && nx < gx + size && nz >= gz && nz < gz + size) continue;
					if (nx < 0 || nz < 0 || nx >= GRID_SIZE || nz >= GRID_SIZE) continue;
					const cell = cellIndex(nx, nz);
					const other = this.hot.get(cell);
					if (other !== undefined && other !== line) return true;
					const belt = this.belts.get(cell);
					if (hot && belt !== undefined && belt !== line) return true;
				}
			}
		}
		return false;
	}

	private beltFree(gx: number, gz: number, line: number, blocked: ReadonlySet<number>): boolean {
		const cell = cellIndex(gx, gz);
		// The cells round the Core stay free for its own lines.
		return (
			this.fits("conveyor", gx, gz, false) &&
			(line === CORE_LINE || !this.coreRing.has(cell)) &&
			!blocked.has(cell) &&
			!this.clashes(gx, gz, 1, line, false)
		);
	}

	private drillSpot(gx: number, gz: number, ore: ResourceId, line: number, blocked: ReadonlySet<number>): boolean {
		return (
			this.ores.get(cellIndex(gx, gz)) === ore &&
			this.fits("drill", gx, gz, false) &&
			!this.onRing(gx, gz) &&
			!blocked.has(cellIndex(gx, gz)) &&
			!this.clashes(gx, gz, 1, line, true)
		);
	}

	private has(ore: ResourceId): boolean {
		return this.nearOres.has(ore);
	}

	private beltKind(): BuildingKind {
		return this.difficulty >= 2 ? "titaniumConveyor" : "conveyor";
	}

	private drillKind(): BuildingKind {
		return this.difficulty >= 1 ? "advancedDrill" : "drill";
	}

	// Core

	/** The Core goes at the site's middle whatever is there: the site is flattened, and it must always stand. */
	private placeCore() {
		const kind = CORES[math.floor(this.difficulty / 2)];
		const size = BUILDINGS[kind].size;
		const gx = math.clamp(math.round((this.site.x + MAP_HALF) / CELL_STUDS - size / 2), 1, GRID_SIZE - 1 - size);
		const gz = math.clamp(math.round((this.site.z + MAP_HALF) / CELL_STUDS - size / 2), 1, GRID_SIZE - 1 - size);
		this.put(kind, gx, gz, 0);
		this.ogx = gx;
		this.ogz = gz;
		this.ox = -MAP_HALF + (gx + size / 2) * CELL_STUDS;
		this.oz = -MAP_HALF + (gz + size / 2) * CELL_STUDS;

		for (let dz = -1; dz <= size; dz++) {
			for (let dx = -1; dx <= size; dx++) {
				const inX = dx >= 0 && dx < size;
				const inZ = dz >= 0 && dz < size;
				if (inX !== inZ) {
					this.coreRing.add(cellIndex(gx + dx, gz + dz));
					this.keep.add(cellIndex(gx + dx, gz + dz));
				}
			}
		}

		// The gap toward the player's Core, and a second on the side its offset leans.
		const to = this.map.layout.core;
		const px = to.x - this.ox;
		const pz = to.z - this.oz;
		if (math.abs(px) >= math.abs(pz)) {
			this.face = px > 0 ? 3 : 1;
			this.gap = pz >= 0 ? 2 : 0;
		} else {
			this.face = pz > 0 ? 2 : 0;
			this.gap = px >= 0 ? 3 : 1;
		}
		for (let z = this.ogz - SPAN; z <= this.ogz + SPAN; z++) {
			for (let x = this.ogx - SPAN; x <= this.ogx + SPAN; x++) {
				if (x < 0 || z < 0 || x >= GRID_SIZE || z >= GRID_SIZE) continue;
				const [rx, rz] = this.rel(x, z);
				for (const side of [this.face, this.gap]) {
					const [sx, sz] = DIRECTIONS[side];
					const along = rx * sx + rz * sz;
					const across = math.abs(rx * sz - rz * sx);
					if (along >= 0 && across <= LANE_HALF) this.keep.add(cellIndex(x, z));
				}
			}
		}
	}

	// Routes

	/**
	 * Floods out from `starts` over free ground, over cells on `line`'s own terms (see `clashes`), to the
	 * nearest spot a drill can go on `ore`. The belts back from it run to the start it reached. Undefined
	 * if there's none within `SEARCH` cells.
	 */
	private route(starts: ReadonlyArray<Step>, ore: ResourceId, line: number, blocked: ReadonlySet<number>) {
		const parent = new Map<number, number>();
		const rotation = new Map<number, number>();
		/** The side each cell was entered by, for the ring: a belt crosses it straight, never along it. */
		const entered = new Map<number, number>();
		/** Cells reached by hopping over a belt, and the belt. */
		const hopped = new Map<number, number>();
		const queue = new Array<number>();
		for (const [gx, gz, turn] of starts) {
			const cell = cellIndex(gx, gz);
			if (parent.has(cell) || !this.beltFree(gx, gz, line, blocked)) continue;
			parent.set(cell, -1);
			rotation.set(cell, turn);
			queue.push(cell);
		}
		// A while: roblox-ts compiles this `for` to a numeric for that never sees the queue grow.
		let head = 0;
		while (head < queue.size()) {
			const from = queue[head++];
			const [gx, gz] = cellCoords(from);
			const locked = entered.get(from);
			for (let side = 0; side < 4; side++) {
				if (locked !== undefined && side !== locked) continue;
				const [dx, dz] = DIRECTIONS[side];
				const nx = gx + dx;
				const nz = gz + dz;
				if (math.abs(nx - this.ogx) > SEARCH || math.abs(nz - this.ogz) > SEARCH) continue;
				if (nx < 0 || nz < 0 || nx >= GRID_SIZE || nz >= GRID_SIZE) continue;
				const ahead = cellIndex(nx, nz);
				if (parent.has(ahead)) continue;
				if (this.drillSpot(nx, nz, ore, line, blocked)) {
					const belts = new Array<Step>();
					const junctions = new Array<number>();
					for (let cell: number = from; cell !== -1; cell = parent.get(cell)!) {
						const [bx, bz] = cellCoords(cell);
						belts.push([bx, bz, rotation.get(cell)!]);
						if (hopped.has(cell)) junctions.push(hopped.get(cell)!);
					}
					return { belts, drill: [nx, nz], junctions } as Route;
				}
				if (!this.beltFree(nx, nz, line, blocked)) {
					// Over the belt in the way, to the cell beyond it.
					const beyond = cellIndex(nx + dx, nz + dz);
					if (locked === undefined && !parent.has(beyond) && this.hoppable(nx, nz, side, line, blocked)) {
						parent.set(beyond, from);
						hopped.set(beyond, ahead);
						rotation.set(beyond, directionOf(-dx, -dz)!);
						queue.push(beyond);
					}
					continue;
				}
				if (this.onRing(nx, nz)) {
					if (this.onRing(nx + dx, nz + dz)) continue;
					entered.set(ahead, side);
				}
				parent.set(ahead, from);
				// Faces back the way it was reached.
				rotation.set(ahead, directionOf(-dx, -dz)!);
				queue.push(ahead);
			}
		}
		return undefined;
	}

	/**
	 * Whether a route heading `side` can hop over the belt on (gx, gz): it runs straight across, fed
	 * from straight behind, and the cell beyond is free for a belt. The hopped belt becomes a Junction.
	 */
	private hoppable(gx: number, gz: number, side: number, line: number, blocked: ReadonlySet<number>): boolean {
		const index = this.beltAt.get(cellIndex(gx, gz));
		if (index === undefined || this.onRing(gx, gz)) return false;
		const over = this.out[index];
		if (!isBelt(over.kind) || over.rotation % 2 === side % 2) return false;
		const [bx, bz] = DIRECTIONS[over.rotation];
		const before = this.beltAt.get(cellIndex(gx - bx, gz - bz));
		if (before === undefined || this.out[before].rotation !== over.rotation || !isBelt(this.out[before].kind)) {
			return false;
		}
		const [dx, dz] = DIRECTIONS[side];
		return !this.onRing(gx + dx, gz + dz) && this.beltFree(gx + dx, gz + dz, line, blocked);
	}

	/** Lays a route: its belts, its drill, and up to `extra` more drills on `ore` beside the belts nearest it. */
	private lay(route: Route, ore: ResourceId, line: number, extra: number, blocked: ReadonlySet<number>) {
		for (const [gx, gz, turn] of route.belts) this.put(this.beltKind(), gx, gz, turn, line);
		for (const cell of route.junctions) {
			const index = this.beltAt.get(cell);
			if (index !== undefined && isBelt(this.out[index].kind))
				this.out[index] = { kind: "junction", cell, rotation: 0, links: [] };
		}
		this.put(this.drillKind(), route.drill[0], route.drill[1], 0, line);
		let more = extra;
		for (const [gx, gz] of route.belts) {
			for (const [dx, dz] of DIRECTIONS) {
				if (more <= 0) return;
				if (!this.drillSpot(gx + dx, gz + dz, ore, line, blocked)) continue;
				this.put(this.drillKind(), gx + dx, gz + dz, 0, line);
				more--;
			}
		}
	}

	/** Drills and belts into the Core, for `ore`. */
	private outpost(ore: ResourceId): boolean {
		const starts = new Array<Step>();
		const [cx, cz] = cellCoords(this.out[0].cell);
		const size = BUILDINGS[this.out[0].kind].size;
		for (let i = -1; i <= size; i++) {
			// Round the Core's four sides, each belt facing in.
			starts.push([cx + i, cz - 1, 2], [cx + i, cz + size, 0], [cx - 1, cz + i, 3], [cx + size, cz + i, 1]);
		}
		const live = starts.filter(([gx, gz]) => this.coreRing.has(cellIndex(gx, gz)));
		const none = new Set<number>();
		const route = this.route(live, ore, CORE_LINE, none);
		if (!route) return false;
		this.lay(route, ore, CORE_LINE, 1 + this.difficulty, none);
		return true;
	}

	/** Core lines for the first of `OUTPOSTS` there is ore for, until there are `count`. */
	private outposts(count: number) {
		for (const ore of OUTPOSTS) {
			if (this.made.size() >= count) return;
			if (!this.made.includes(ore) && this.has(ore) && this.outpost(ore)) this.made.push(ore);
		}
	}

	// Hubs

	/** Hub origins to try, best first: toward the player's Core for `bias` 1, away for -1. */
	private hubSpots(bias: number): Array<readonly [number, number, number]> {
		const spots = new Array<{
			readonly gx: number;
			readonly gz: number;
			readonly f: number;
			readonly score: number;
		}>();
		const [fx, fz] = DIRECTIONS[this.face];
		for (let gz = this.ogz - SPAN; gz <= this.ogz + SPAN; gz++) {
			for (let gx = this.ogx - SPAN; gx <= this.ogx + SPAN; gx++) {
				if (
					!this.fits("conveyor", gx, gz, false) ||
					!this.inside(gx, gz, 1) ||
					this.keep.has(cellIndex(gx, gz))
				)
					continue;
				if (this.hubs.some(([hx, hz]) => math.max(math.abs(hx - gx), math.abs(hz - gz)) < HUB_SPACING))
					continue;
				const [rx, rz] = this.rel(gx, gz);
				for (let f = 0; f < 4; f++) {
					const outward = f === (bias > 0 ? this.face : (this.face + 2) % 4) ? 10 : 0;
					const score = bias * (rx * fx + rz * fz) + this.rng.nextNumber() * 16 + outward;
					spots.push({ gx, gz, f, score });
				}
			}
		}
		spots.sort((a, b) => a.score > b.score);
		return spots.map(({ gx, gz, f }) => [gx, gz, f] as const);
	}

	/**
	 * Puts a `hub` with `slots` round it and a belt behind it, at hub origin (hx, hz) facing `f`: slot
	 * buildings touch it on the left, front and right, never overlapping. Returns the belt's cell and the
	 * cells beside the hub it mustn't be fed from, or undefined (put what it had back) if nothing fits.
	 */
	private stamp(
		hub: BuildingKind,
		hx: number,
		hz: number,
		f: number,
		slots: Slots,
		line: number,
	): [belt: Step, hold: Set<number>] | undefined {
		const [fx, fz] = DIRECTIONS[f];
		const [lx, lz] = DIRECTIONS[(f + 1) % 4];
		const h = BUILDINGS[hub].size;
		/** The corner cell of the `size` block starting `a` ahead and `b` left of the hub origin. */
		const corner = (a: number, b: number, size: number): [number, number] => {
			const x1 = hx + fx * a + lx * b;
			const z1 = hz + fz * a + lz * b;
			const x2 = hx + fx * (a + size - 1) + lx * (b + size - 1);
			const z2 = hz + fz * (a + size - 1) + lz * (b + size - 1);
			return [math.min(x1, x2), math.min(z1, z2)];
		};

		const [cx, cz] = corner(0, 0, h);
		if (!this.fits(hub, cx, cz, true) || this.clashes(cx, cz, h, line, true)) return undefined;
		const mark = this.out.size();
		this.put(hub, cx, cz, 0, line);
		let placed = 0;
		const slot = (kind: BuildingKind | undefined, a: (size: number) => number, b: (size: number) => number) => {
			if (kind === undefined) return;
			const size = BUILDINGS[kind].size;
			const [gx, gz] = corner(a(size), b(size), size);
			if (!this.fits(kind, gx, gz, true)) return;
			this.put(kind, gx, gz, f);
			placed++;
		};
		slot(
			slots.left,
			(s) => h - s,
			() => h,
		);
		slot(
			slots.right,
			(s) => h - s,
			(s) => -s,
		);
		slot(
			slots.front,
			() => h,
			(s) => (s > h ? -math.floor((s - h) / 2) : 0),
		);
		const bx = hx - fx;
		const bz = hz - fz;
		if (placed === 0 || !this.beltFree(bx, bz, line, new Set())) {
			this.rollback(mark);
			return undefined;
		}

		const hold = new Set<number>();
		for (let dz = 0; dz < h; dz++) {
			for (let dx = 0; dx < h; dx++) {
				for (const [sx, sz] of DIRECTIONS) {
					const [gx, gz] = [cx + dx + sx, cz + dz + sz];
					if (gx >= cx && gx < cx + h && gz >= cz && gz < cz + h) continue;
					if (gx !== bx || gz !== bz) hold.add(cellIndex(gx, gz));
				}
			}
		}
		return [[bx, bz, f], hold];
	}

	/** Makes a hub with its ore line, in the best spot that has a route to ore. `extra` more drills load the line. */
	private hub(hub: BuildingKind, slots: Slots, ore: ResourceId, bias: number, extra: number): boolean {
		const line = this.nextLine++;
		let tries = 0;
		for (const [hx, hz, f] of this.hubSpots(bias)) {
			const mark = this.out.size();
			const stamped = this.stamp(hub, hx, hz, f, slots, line);
			if (stamped) {
				const [start, hold] = stamped;
				const route = this.route([start], ore, line, hold);
				if (route) {
					this.lay(route, ore, line, extra, hold);
					this.hubs.push([hx, hz]);
					return true;
				}
				this.rollback(mark);
				if (++tries >= HUB_TRIES) return false;
			}
		}
		return false;
	}

	/** A nest of turrets round a hub, firing the ore of `want`'s family, or the next that has ore and a turret for this difficulty. */
	private nest(want: Family) {
		let family: Family | undefined;
		for (const option of [want, ...FALLBACK]) {
			const spec = FAMILIES[option];
			if (this.has(spec.ore) && spec.turrets.some(([, from]) => from <= this.difficulty)) {
				family = option;
				break;
			}
		}
		if (family === undefined) return;
		const spec = FAMILIES[family];
		const kinds = spec.turrets.filter(([, from]) => from <= this.difficulty).map(([kind]) => kind);
		const pick = () => kinds[this.rng.nextInt(kinds.size())];
		const best = kinds[kinds.size() - 1];
		const hub = spec.press ? "graphitePress" : "router";
		const extra = this.difficulty >= 3 ? 1 : 0;
		const full: Slots = { left: pick(), right: pick(), front: this.difficulty === 0 ? undefined : best };
		if (this.hub(hub, full, spec.ore, 1, extra)) return;
		// Too big for the room: the weakest kind, on the sides.
		this.hub(hub, { left: kinds[0], right: kinds[0] }, spec.ore, 1, extra);
	}

	// Power

	private generation(): number {
		let made = 0;
		for (const { kind } of this.out) made += BUILDINGS[kind].generator?.power ?? 0;
		return made;
	}

	/** The best free cell for a loose building, toward (bias 1) or away from (-1) the player's Core. Returns its corner. */
	private best(kind: BuildingKind, bias: number): [number, number] | undefined {
		const [fx, fz] = DIRECTIONS[this.face];
		let found: [number, number] | undefined;
		let top = -math.huge;
		for (let gz = this.ogz - SPAN; gz <= this.ogz + SPAN; gz++) {
			for (let gx = this.ogx - SPAN; gx <= this.ogx + SPAN; gx++) {
				if (!this.fits(kind, gx, gz, true)) continue;
				const [rx, rz] = this.rel(gx, gz);
				const score = bias * (rx * fx + rz * fz) + this.rng.nextNumber() * 16;
				if (score > top) {
					top = score;
					found = [gx, gz];
				}
			}
		}
		return found;
	}

	/** The nearest free cell to (ax, az) for a loose building. */
	private near(kind: BuildingKind, ax: number, az: number): [number, number] | undefined {
		for (let r = 0; r <= 8; r++) {
			for (let gz = az - r; gz <= az + r; gz++) {
				for (let gx = ax - r; gx <= ax + r; gx++) {
					if (math.max(math.abs(gx - ax), math.abs(gz - az)) === r && this.fits(kind, gx, gz, true))
						return [gx, gz];
				}
			}
		}
		return undefined;
	}

	private loose(kind: BuildingKind, bias: number): [number, number] | undefined {
		const spot = this.best(kind, bias);
		if (spot) this.put(kind, spot[0], spot[1], 0);
		return spot;
	}

	/**
	 * Generators, and what uses their power. Solar panels and batteries always; on 2 and up, Combustion
	 * Generators on a coal line, and on 4 RTGs on a thorium one. Powered turrets and menders only as far
	 * as it all makes power for (one Arc for every 100 a second), so none sit unfed.
	 */
	private power() {
		const d = this.difficulty;
		const gens = d >= 3 ? 2 : 1;
		const burn: Slots = { left: "combustionGenerator", front: "combustionGenerator", right: "combustionGenerator" };
		if (d >= 2 && this.has("coal")) for (let i = 0; i < gens; i++) this.hub("router", burn, "coal", -1, 1);
		if (d >= 4 && this.has("thorium")) {
			this.hub(
				"router",
				{ left: "rtgGenerator", front: "rtgGenerator", right: "rtgGenerator" },
				"thorium",
				-1,
				0,
			);
		}

		const first = this.loose("solarPanel", -1);
		if (first) {
			for (let i = 1; i < math.min(4 + 2 * d, 12); i++) {
				const spot = this.near("solarPanel", first[0], first[1]);
				if (spot) this.put("solarPanel", spot[0], spot[1], 0);
			}
			for (let i = 0; i < (d >= 2 ? 2 : 1); i++) {
				const spot = this.near("battery", first[0], first[1]);
				if (spot) this.put("battery", spot[0], spot[1], 0);
			}
		}

		const made = this.generation();
		if (d >= 1) for (let i = 0; i < math.ceil(NESTS[d].size() / 2); i++) this.loose("mender", 1);
		if (d >= 2) for (let i = 0; i < math.min(d, math.floor(made / 100)); i++) this.loose("arc", 1);
		if (d >= 4 && made >= 500 && this.loose("meltdown", 1)) this.loose("largeBattery", -1);
	}

	/**
	 * Power nodes: each powered building joins the nearest node in reach with a link to spare, or gets a
	 * new node as near the middle of them all as it reaches. Then the nodes are joined into one network,
	 * through more nodes where they're out of reach. Two links of each node are kept for other nodes.
	 */
	private linkPower() {
		const main: BuildingKind = this.difficulty <= 1 ? "powerNode" : "largePowerNode";
		const kinds: ReadonlyArray<BuildingKind> = main === "powerNode" ? [main] : [main, "powerNode"];
		const leaves = new Array<number>();
		let sumX = 0;
		let sumZ = 0;
		this.out.forEach(({ kind: built, cell }, index) => {
			if (!isPowered(built) || BUILDINGS[built].node !== undefined) return;
			leaves.push(index);
			const [gx, gz] = cellCoords(cell);
			sumX += gx;
			sumZ += gz;
		});
		if (leaves.isEmpty()) return;
		const midX = sumX / leaves.size();
		const midZ = sumZ / leaves.size();
		// What uses power first, so it's the generators and batteries that go unlinked if nodes run out.
		const draws = (index: number) => BUILDINGS[this.out[index].kind].power !== undefined;
		leaves.sort((a, b) => (draws(a) !== draws(b) ? draws(a) : a < b));

		const nodes = new Array<number>();
		const used = new Map<number, number>();
		const comp = new Map<number, number>();
		const cap = (node: number) => BUILDINGS[this.out[node].kind].node!;
		const spare = (node: number, keep: number) => (used.get(node) ?? 0) < cap(node) - keep;
		const reach = (a: number, b: number) =>
			linkReach(this.out[a].kind, this.out[a].cell, this.out[b].kind, this.out[b].cell);
		const link = (node: number, other: number) => {
			this.out[node].links.push(this.out[other].cell);
			used.set(node, (used.get(node) ?? 0) + 1);
			if (BUILDINGS[this.out[other].kind].node !== undefined) used.set(other, (used.get(other) ?? 0) + 1);
		};
		const gap = (a: number, b: number) => {
			const [ax, az] = cellCoords(this.out[a].cell);
			const [bx, bz] = cellCoords(this.out[b].cell);
			return (ax - bx) ** 2 + (az - bz) ** 2;
		};
		/**
		 * Puts a node within `radius(kind)` cells of (cx, cz) that `ok` allows, nearest (goalX, goalZ). The
		 * big node first, inside the ring, then outside it, then the same for the small one.
		 */
		const make = (
			cx: number,
			cz: number,
			radius: (kind: BuildingKind) => number,
			ok: (kind: BuildingKind, gx: number, gz: number) => boolean,
			goalX: number,
			goalZ: number,
		): number | undefined => {
			for (const kind of kinds) {
				for (const bounded of [true, false]) {
					const r = radius(kind);
					let spot: [number, number] | undefined;
					let nearest = math.huge;
					for (let gz = cz - r; gz <= cz + r; gz++) {
						for (let gx = cx - r; gx <= cx + r; gx++) {
							if (!this.fits(kind, gx, gz, bounded) || !ok(kind, gx, gz)) continue;
							const d = (gx - goalX) ** 2 + (gz - goalZ) ** 2;
							if (d < nearest) {
								nearest = d;
								spot = [gx, gz];
							}
						}
					}
					if (spot) {
						this.put(kind, spot[0], spot[1], 0);
						nodes.push(this.out.size() - 1);
						return this.out.size() - 1;
					}
				}
			}
			return undefined;
		};

		for (const leaf of leaves) {
			let node: number | undefined;
			for (const other of nodes) {
				if (
					spare(other, 2) &&
					reach(other, leaf) &&
					(node === undefined || gap(other, leaf) < gap(node, leaf))
				) {
					node = other;
				}
			}
			if (node === undefined) {
				const [lx, lz] = cellCoords(this.out[leaf].cell);
				const built = this.out[leaf];
				node = make(
					lx,
					lz,
					(kind) => math.ceil((BUILDINGS[kind].range ?? 0) / CELL_STUDS) + BUILDINGS[built.kind].size,
					(kind, gx, gz) => linkReach(kind, cellIndex(gx, gz), built.kind, built.cell),
					midX,
					midZ,
				);
				if (node === undefined) continue;
				comp.set(node, node);
			}
			link(node, leaf);
		}

		// One network: join the nearest nodes of different groups, shortest first.
		const merge = (from: number, to: number) => {
			for (const node of nodes) if (comp.get(node) === from) comp.set(node, to);
		};
		const couples = new Array<readonly [number, number, number]>();
		for (let i = 0; i < nodes.size(); i++) {
			for (let j = i + 1; j < nodes.size(); j++) couples.push([nodes[i], nodes[j], gap(nodes[i], nodes[j])]);
		}
		couples.sort((p, q) => (p[2] !== q[2] ? p[2] < q[2] : p[0] !== q[0] ? p[0] < q[0] : p[1] < q[1]));
		for (const [a, b] of couples) {
			if (comp.get(a) === comp.get(b) || !reach(a, b) || !spare(a, 0) || !spare(b, 0)) continue;
			link(a, b);
			merge(comp.get(b)!, comp.get(a)!);
		}
		// Still apart: a chain of nodes from the nearest pair, each as far on as it reaches.
		for (const [a, b] of couples) {
			if (comp.get(a) === comp.get(b)) continue;
			let from = a;
			for (let step = 0; step < 12; step++) {
				if (reach(from, b) && spare(from, 0) && spare(b, 0)) {
					link(from, b);
					merge(comp.get(b)!, comp.get(a)!);
					break;
				}
				// The free cell furthest toward `b` that `from` still reaches.
				const [fx, fz] = cellCoords(this.out[from].cell);
				const [bx, bz] = cellCoords(this.out[b].cell);
				const source = this.out[from];
				const hopped = spare(from, 0)
					? make(
							fx,
							fz,
							(kind) =>
								math.ceil((BUILDINGS[kind].range ?? 0) / CELL_STUDS) + BUILDINGS[source.kind].size,
							(kind, gx, gz) => linkReach(kind, cellIndex(gx, gz), source.kind, source.cell),
							bx,
							bz,
						)
					: undefined;
				if (hopped === undefined) break;
				comp.set(hopped, comp.get(a)!);
				link(from, hopped);
				from = hopped;
			}
		}
	}

	// Walls

	/** The ring: a wall on every free cell of it. The lanes stay open (see `keep`), and what's already built stands in for a wall. */
	private walls() {
		const kind: BuildingKind = this.difficulty >= 2 ? "titaniumWall" : "wall";
		for (let gz = this.ogz - SPAN; gz <= this.ogz + SPAN; gz++) {
			for (let gx = this.ogx - SPAN; gx <= this.ogx + SPAN; gx++) {
				if (this.onRing(gx, gz) && this.fits(kind, gx, gz, false)) this.put(kind, gx, gz, 0);
			}
		}
	}
}

/**
 * Plans the enemy base at `site` (an attack base site, see `Layout.spawns`) on `map`, for a difficulty
 * from 0 to 4. The Core stands on the site's middle, with turret nests on the side facing the player's
 * Core, power, drill outposts belting ore in, and a wall ring with a gap each side of two. Apply the
 * entries in order, every one before any `links`. The same inputs always plan the same base; a module
 * that doesn't fit is left out, the Core never is. Nothing here touches the world.
 */
export function planEnemyBase(map: PlanetMap, site: Point, difficulty: number, seed: number): Array<EnemyBuilding> {
	return new Planner(map, site, math.clamp(math.floor(difficulty), 0, 4), seed).plan();
}

/**
 * Runs the ore of a plan through `LogisticsService`'s rules, without a world: drills and presses hand
 * ore to every neighbour that takes it, belts to what is in front, routers to every side but the one it
 * came from and junctions straight on. Errors if ore reaches a belt or router nothing beside takes it
 * (it would clog the line), or if a turret or generator never gets any ore it uses.
 */
function checkFlow(
	name: string,
	plan: ReadonlyArray<EnemyBuilding>,
	owner: ReadonlyMap<number, number>,
	oreOf: ReadonlyMap<number, ResourceId>,
): void {
	const at = (gx: number, gz: number) => owner.get(cellIndex(gx, gz));
	/** Every building touching building `i`, and the side of `i` it is on. */
	const around = (i: number): Array<[number, number]> => {
		const touching = new Array<[number, number]>();
		const [gx, gz] = cellCoords(plan[i].cell);
		const size = BUILDINGS[plan[i].kind].size;
		for (let dz = 0; dz < size; dz++) {
			for (let dx = 0; dx < size; dx++) {
				DIRECTIONS.forEach(([sx, sz], side) => {
					const other = at(gx + dx + sx, gz + dz + sz);
					if (other !== undefined && other !== i) touching.push([other, side]);
				});
			}
		}
		return touching;
	};

	const got = plan.map(() => new Set<ResourceId>());
	const work = new Array<[target: number, resource: ResourceId, from: number]>();
	/** Offers `resource`, heading `side` out of `from`, to `target`. True if it takes it. */
	const give = (target: number, resource: ResourceId, from: number, side: number, hops = 0): boolean => {
		const { kind, rotation, cell } = plan[target];
		const def = BUILDINGS[kind];
		if (isBelt(kind)) {
			if ((side + 2) % 4 === rotation) return false;
		} else if (kind === "junction") {
			const [gx, gz] = cellCoords(cell);
			const onward = at(gx + DIRECTIONS[side][0], gz + DIRECTIONS[side][1]);
			return hops < 8 && onward !== undefined && give(onward, resource, target, side, hops + 1);
		} else if (def.turret) {
			if (def.turret.ammo[resource] === undefined) return false;
		} else if (def.craft) {
			if (!def.craft.inputs.some((input) => input.resource === resource)) return false;
		} else if (def.generator) {
			if (def.generator.fuel?.[resource] === undefined) return false;
		} else if (kind !== "router" && !isCore(kind)) return false;
		if (!got[target].has(resource)) {
			got[target].add(resource);
			work.push([target, resource, from]);
		}
		return true;
	};
	const hand = (from: number, resource: ResourceId) => {
		for (const [other, side] of around(from)) give(other, resource, from, side);
	};

	plan.forEach((entry, i) => {
		if (BUILDINGS[entry.kind].drill) {
			const ore = oreOf.get(entry.cell);
			if (ore !== undefined) hand(i, ore);
		}
	});
	// A while: roblox-ts compiles this `for` to a numeric for that never sees `work` grow.
	let w = 0;
	while (w < work.size()) {
		const [target, resource, from] = work[w++];
		const { kind, rotation, cell } = plan[target];
		if (isBelt(kind)) {
			const [gx, gz] = cellCoords(cell);
			const onward = at(gx + DIRECTIONS[rotation][0], gz + DIRECTIONS[rotation][1]);
			assert(
				onward !== undefined && give(onward, resource, target, rotation),
				`${name}: ${resource} clogs the belt at cell ${cell}`,
			);
		} else if (kind === "router") {
			let taken = false;
			for (const [other, side] of around(target))
				if (other !== from && give(other, resource, target, side)) taken = true;
			assert(taken, `${name}: ${resource} clogs the router at cell ${cell}`);
		} else if (BUILDINGS[kind].craft && !got[target].has(BUILDINGS[kind].craft!.output)) {
			// A press that has coal makes graphite for whatever touches it.
			got[target].add(BUILDINGS[kind].craft!.output);
			hand(target, BUILDINGS[kind].craft!.output);
		}
	}

	plan.forEach(({ kind, cell }, i) => {
		const def = BUILDINGS[kind];
		if (def.turret && !def.turret.energy) {
			const ammo = new Array<ResourceId>();
			for (const [resource] of pairs(def.turret.ammo)) ammo.push(resource);
			assert(
				ammo.some((resource) => got[i].has(resource)),
				`${name}: ${kind} at cell ${cell} never gets ammo`,
			);
		}
		if (def.generator?.fuel) assert(!got[i].isEmpty(), `${name}: ${kind} at cell ${cell} never gets fuel`);
	});
}

/**
 * Self-check for the debug panel or Studio, not run at import: plans a base at each of `map`'s spawn
 * sites for every difficulty and a few seeds, and errors on the first problem: a missing Core, an
 * overlap, a building off the map or on cliff, deep liquid or steep ground, a drill off ore, a belt
 * that leads nowhere, a link out of range or beyond a node's limit, a powered building on no network
 * with a generator, fewer than two wall gaps of 3 cells, or a plan that differs between two runs.
 */
export function checkEnemyBase(map: PlanetMap): void {
	const oreOf = new Map<number, ResourceId>();
	for (const deposit of map.ores) oreOf.set(deposit.cell, deposit.resource);

	map.layout.spawns.forEach((site, siteIndex) => {
		for (let difficulty = 0; difficulty <= 4; difficulty++) {
			for (let seed = 1; seed <= 3; seed++) {
				const name = `site ${siteIndex}, difficulty ${difficulty}, seed ${seed}`;
				const plan = planEnemyBase(map, site, difficulty, seed);
				const again = planEnemyBase(map, site, difficulty, seed);
				assert(plan.size() === again.size(), `${name}: not deterministic`);
				plan.forEach((entry, i) => {
					assert(
						entry.kind === again[i].kind &&
							entry.cell === again[i].cell &&
							entry.rotation === again[i].rotation,
						`${name}: entry ${i} differs between runs`,
					);
				});

				const owner = new Map<number, number>();
				const core = plan.find((entry) => isCore(entry.kind));
				assert(core !== undefined, `${name}: no Core`);
				plan.forEach((entry, i) => {
					const def = BUILDINGS[entry.kind];
					const [gx, gz] = cellCoords(entry.cell);
					assert(
						gx >= 0 && gz >= 0 && gx + def.size <= GRID_SIZE && gz + def.size <= GRID_SIZE,
						`${name}: ${entry.kind} off the map`,
					);
					assert(
						entry.rotation >= 0 && entry.rotation < 4 && entry.rotation % 1 === 0,
						`${name}: bad rotation on ${entry.kind}`,
					);
					let drillOre = false;
					for (let dz = 0; dz < def.size; dz++) {
						for (let dx = 0; dx < def.size; dx++) {
							const cell = cellIndex(gx + dx, gz + dz);
							assert(
								!owner.has(cell),
								`${name}: ${entry.kind} overlaps ${plan[owner.get(cell) ?? 0].kind} at cell ${cell}`,
							);
							owner.set(cell, i);
							if (oreOf.has(cell)) drillOre = true;
							if (!isCore(entry.kind)) {
								const x = -MAP_HALF + (gx + dx + 0.5) * CELL_STUDS;
								const z = -MAP_HALF + (gz + dz + 0.5) * CELL_STUDS;
								assert(
									!map.cliff(cell) && !map.isDeep(x, z),
									`${name}: ${entry.kind} on cliff or deep liquid at cell ${cell}`,
								);
							}
						}
					}
					if (isCore(entry.kind)) return;
					if (!isBelt(entry.kind)) {
						const [low, high] = map.groundRange(entry.cell, def.size);
						assert(high - low <= PLACE_MAX_SLOPE, `${name}: ${entry.kind} on steep ground`);
					}
					if (def.drill) assert(drillOre, `${name}: ${entry.kind} not on ore`);
				});

				// Every belt carries on into a building, never head-on into another belt.
				for (const entry of plan) {
					if (!isBelt(entry.kind)) continue;
					const [gx, gz] = cellCoords(entry.cell);
					const [dx, dz] = DIRECTIONS[entry.rotation];
					const ahead = owner.get(cellIndex(gx + dx, gz + dz));
					assert(ahead !== undefined, `${name}: belt at cell ${entry.cell} leads nowhere`);
					const onward = plan[ahead!];
					assert(
						!(isBelt(onward.kind) && onward.rotation === (entry.rotation + 2) % 4),
						`${name}: belts at ${entry.cell} and ${onward.cell} face each other`,
					);
					assert(
						BUILDINGS[onward.kind].wall !== true &&
							onward.kind !== "advancedDrill" &&
							onward.kind !== "drill",
						`${name}: belt at ${entry.cell} runs into a ${onward.kind}`,
					);
				}

				checkFlow(name, plan, owner, oreOf);

				// Links: in range, within a node's limit, and every powered building on a network with a generator.
				const adjacent = plan.map(() => new Array<number>());
				const degree = plan.map(() => 0);
				plan.forEach((entry, i) => {
					for (const target of entry.links) {
						const j = owner.get(target);
						assert(
							j !== undefined && plan[j].cell === target,
							`${name}: ${entry.kind} links to nothing at cell ${target}`,
						);
						const other = plan[j!];
						assert(
							isPowered(other.kind),
							`${name}: ${entry.kind} links to ${other.kind}, which has no power`,
						);
						assert(
							BUILDINGS[entry.kind].node !== undefined,
							`${name}: link from a ${entry.kind}, which is no node`,
						);
						assert(
							linkReach(entry.kind, entry.cell, other.kind, other.cell),
							`${name}: ${entry.kind} out of range of ${other.kind}`,
						);
						adjacent[i].push(j!);
						adjacent[j!].push(i);
						degree[i]++;
						if (BUILDINGS[other.kind].node !== undefined) degree[j!]++;
					}
				});
				plan.forEach((entry, i) => {
					const most = BUILDINGS[entry.kind].node;
					if (most !== undefined)
						assert(degree[i] <= most, `${name}: ${entry.kind} has ${degree[i]} links, over ${most}`);
				});
				const seen = new Set<number>();
				plan.forEach((entry, start) => {
					if (seen.has(start) || !isPowered(entry.kind)) return;
					const network = [start];
					seen.add(start);
					let powered = false;
					// A while: roblox-ts compiles this `for` to a numeric for that never sees `network` grow.
					let i = 0;
					while (i < network.size()) {
						const member = network[i++];
						const def = BUILDINGS[plan[member].kind];
						if (def.generator) powered = true;
						for (const onward of adjacent[member]) {
							if (seen.has(onward)) continue;
							seen.add(onward);
							network.push(onward);
						}
					}
					for (const member of network) {
						const def = BUILDINGS[plan[member].kind];
						assert(
							def.power === undefined || powered,
							`${name}: ${plan[member].kind} has no generator on its network`,
						);
					}
				});

				// The wall ring: at least two runs of 3 or more cells with no wall in them.
				const size = BUILDINGS[core!.kind].size;
				const [cx, cz] = cellCoords(core!.cell);
				assert(owner.get(core!.cell) === plan.indexOf(core!), `${name}: Core not first`);
				const ox = -MAP_HALF + (cx + size / 2) * CELL_STUDS;
				const oz = -MAP_HALF + (cz + size / 2) * CELL_STUDS;
				const ring = new Array<{ readonly angle: number; readonly walled: boolean }>();
				for (let gz = cz - SPAN; gz <= cz + SPAN; gz++) {
					for (let gx = cx - SPAN; gx <= cx + SPAN; gx++) {
						const x = -MAP_HALF + (gx + 0.5) * CELL_STUDS - ox;
						const z = -MAP_HALF + (gz + 0.5) * CELL_STUDS - oz;
						const d = math.max(math.abs(x), math.abs(z));
						if (d <= RING - 4 || d > RING + 4) continue;
						const at = owner.get(cellIndex(gx, gz));
						ring.push({
							angle: math.atan2(z, x),
							walled: at !== undefined && BUILDINGS[plan[at].kind].wall === true,
						});
					}
				}
				ring.sort((a, b) => a.angle < b.angle);
				// Start just after a wall, so no run is split by the seam.
				const from = ring.findIndex((cell) => cell.walled);
				let gaps = 0;
				let run = 0;
				for (let i = 1; from >= 0 && i <= ring.size(); i++) {
					if (ring[(from + i) % ring.size()].walled) {
						if (run >= 3) gaps++;
						run = 0;
					} else run++;
				}
				assert(from < 0 || gaps >= 2, `${name}: ${gaps} wall gaps`);
			}
		}
	});
}
