/**
 * A planet's map: a square of `MAP_STUDS` centred on the world origin, written
 * as 64-stud terrain chunks and built on as 8-stud cells. Cells are numbered
 * row by row from the -X/-Z corner: `index = gz * GRID_SIZE + gx`.
 */
export const CHUNK_STUDS = 64;
export const MAP_CHUNKS = 24;
export const MAP_STUDS = CHUNK_STUDS * MAP_CHUNKS;
export const MAP_HALF = MAP_STUDS / 2;

export const CELL_STUDS = 8;
export const GRID_SIZE = MAP_STUDS / CELL_STUDS;

export function cellIndex(gx: number, gz: number): number {
	return gz * GRID_SIZE + gx;
}

/** The cell under a world point, or `undefined` off the map. */
export function cellAt(x: number, z: number): number | undefined {
	const gx = math.floor((x + MAP_HALF) / CELL_STUDS);
	const gz = math.floor((z + MAP_HALF) / CELL_STUDS);
	if (gx < 0 || gz < 0 || gx >= GRID_SIZE || gz >= GRID_SIZE) return undefined;
	return cellIndex(gx, gz);
}

/** A cell's grid column and row. */
export function cellCoords(index: number): [gx: number, gz: number] {
	return [index % GRID_SIZE, math.floor(index / GRID_SIZE)];
}

/** The centre of a `size`×`size` block of cells whose -X/-Z corner is `index`, at y = 0. */
export function cellCenter(index: number, size = 1): Vector3 {
	const [gx, gz] = cellCoords(index);
	return new Vector3(-MAP_HALF + (gx + size / 2) * CELL_STUDS, 0, -MAP_HALF + (gz + size / 2) * CELL_STUDS);
}
