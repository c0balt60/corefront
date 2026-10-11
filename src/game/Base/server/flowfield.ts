import type { PlanetMap } from "game/Terrain/server/planet-map";
import { CELL_STUDS, cellCenter, cellCoords, cellIndex, GRID_SIZE, MAP_HALF } from "game/Terrain/shared/map";

/** Added to a building's cell: aliens go round when that is cheap enough, and chew through when not. */
const BUILDING_COST = 25;
/** Liquid is slow, never impassable, so every spawn always has a path. */
const LIQUID_COST = 40;
const DIAGONAL = math.sqrt(2);
const STEPS: ReadonlyArray<readonly [number, number]> = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
	[1, 1],
	[1, -1],
	[-1, 1],
	[-1, -1],
];

/**
 * What it costs a ground alien to step onto each cell, from the terrain alone:
 * the height difference across the cell's corners, or liquid. Computed once
 * per map, since terrain never changes under a running mission.
 */
export function terrainCosts(map: PlanetMap): Array<number> {
	const side = GRID_SIZE + 1;
	const corners = new Array<number>();
	for (let gz = 0; gz < side; gz++) {
		for (let gx = 0; gx < side; gx++) {
			corners.push(map.heightAt(-MAP_HALF + gx * CELL_STUDS, -MAP_HALF + gz * CELL_STUDS));
		}
	}

	const costs = new Array<number>();
	for (let cell = 0; cell < GRID_SIZE * GRID_SIZE; cell++) {
		const [gx, gz] = cellCoords(cell);
		const i = gz * side + gx;
		const [a, b, c, d] = [corners[i], corners[i + 1], corners[i + side], corners[i + side + 1]];
		const slope = math.max(a, b, c, d) - math.min(a, b, c, d);
		const center = cellCenter(cell);
		costs.push(map.isLiquid(center.X, center.Z) ? LIQUID_COST : slope < 2.5 ? 1 : slope < 6 ? 6 : 30);
	}
	return costs;
}

/**
 * A Mindustry-style flowfield: Dijkstra outward from `targets` (the Core's
 * cells), so one pass steers every alien. Returns, for each cell, the next
 * cell on its cheapest path there, or -1 for the targets themselves.
 * Buildings are passable but dear, and diagonal steps never cut a building's corner.
 */
export function buildFlowfield(
	costs: ReadonlyArray<number>,
	buildings: ReadonlyMap<number, unknown>,
	targets: ReadonlyArray<number>,
): Array<number> {
	const total = GRID_SIZE * GRID_SIZE;
	const dist = new Array<number>(total, math.huge);
	const toward = new Array<number>(total, -1);

	// Binary min-heap on parallel arrays. Stale entries are skipped on pop rather than updated in place.
	const heapCell = new Array<number>();
	const heapDist = new Array<number>();
	const push = (cell: number, d: number) => {
		let i = heapCell.size();
		while (i > 0) {
			const parent = math.floor((i - 1) / 2);
			if (heapDist[parent] <= d) break;
			heapCell[i] = heapCell[parent];
			heapDist[i] = heapDist[parent];
			i = parent;
		}
		heapCell[i] = cell;
		heapDist[i] = d;
	};
	const pop = () => {
		const top = heapCell[0];
		const lastCell = heapCell.pop()!;
		const lastDist = heapDist.pop()!;
		const size = heapCell.size();
		if (size > 0) {
			let i = 0;
			while (true) {
				let child = 2 * i + 1;
				if (child >= size) break;
				if (child + 1 < size && heapDist[child + 1] < heapDist[child]) child++;
				if (heapDist[child] >= lastDist) break;
				heapCell[i] = heapCell[child];
				heapDist[i] = heapDist[child];
				i = child;
			}
			heapCell[i] = lastCell;
			heapDist[i] = lastDist;
		}
		return top;
	};

	for (const target of targets) {
		dist[target] = 0;
		push(target, 0);
	}

	while (!heapCell.isEmpty()) {
		const d = heapDist[0];
		const u = pop();
		if (d > dist[u]) continue;

		// Edges run backwards: an alien on v steps onto u, and pays u's cost to do it.
		const [ux, uz] = cellCoords(u);
		const enter = costs[u] + (buildings.has(u) ? BUILDING_COST : 0);
		for (const [dx, dz] of STEPS) {
			const vx = ux - dx;
			const vz = uz - dz;
			if (vx < 0 || vz < 0 || vx >= GRID_SIZE || vz >= GRID_SIZE) continue;
			const diagonal = dx !== 0 && dz !== 0;
			if (diagonal && (buildings.has(cellIndex(ux, vz)) || buildings.has(cellIndex(vx, uz)))) continue;

			const v = cellIndex(vx, vz);
			const nd = d + enter * (diagonal ? DIAGONAL : 1);
			if (nd < dist[v]) {
				dist[v] = nd;
				toward[v] = u;
				push(v, nd);
			}
		}
	}
	return toward;
}
