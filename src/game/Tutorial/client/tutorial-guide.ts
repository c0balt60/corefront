import { CollectionService, Workspace } from "@rbxts/services";

import { COLORS } from "core/Interface/client/theme";
import { baseStateAtom } from "game/Base/client/base-state";
import { ghostPart, isBeltModel, lineBetween, modelOn, occupancy } from "game/Base/client/BuildController";
import type { Placement } from "game/Base/shared/base-network";
import { chevronBars, DIRECTIONS, directionOf } from "game/Base/shared/belts";
import { BUILDINGS, type BuildingKind, inDropZone, MAX_LINE, nearestZone } from "game/Base/shared/buildings";
import { CELL_STUDS, cellAt, cellCenter, cellCoords, cellIndex, GRID_SIZE } from "game/Terrain/shared/map";

/** How far above and below a point to look for the ground under it. */
const GROUND_SEARCH = 500;
const GUIDE_TRANSPARENCY = 0.5;
/** How far above the ground a tile floats, and how thick it is. */
const TILE_LIFT = 0.4;
const TILE_THICKNESS = 0.3;
const CHEVRON = new Vector3(0.35, 0.15, 1);
/** The last tile of a line, to tell it from the first (`COLORS.accent`). */
const END_COLOR = Color3.fromRGB(90, 160, 235);
/** How far from the Core's edge a turret's spot is aimed, in cells, and how many rings out it may settle. */
const TURRET_CELLS = 3.5;
const SPOT_RINGS = 12;

type Taken = ReadonlyMap<number, Model>;
type Starts = ReadonlyArray<[x: number, z: number]>;

/** A building's -X/-Z corner cell and its size, in cells. */
function footprintOf(model: Model): [x: number, z: number, size: number] {
	const [x, z] = cellCoords(model.GetAttribute("Cell") as number);
	return [x, z, BUILDINGS[model.GetAttribute("Kind") as BuildingKind].size];
}

/** The cells along a building's edge, each with the side of the building it is on. */
function around(model: Model): Array<[x: number, z: number, side: number]> {
	const [x, z, size] = footprintOf(model);
	const cells = new Array<[number, number, number]>();
	for (let i = 0; i < size; i++)
		cells.push([x + i, z - 1, 0], [x - 1, z + i, 1], [x + i, z + size, 2], [x + size, z + i, 3]);
	return cells;
}

/** Whether a belt can go on cell (x, z): on the map, with no building, outside the drop zones. */
function free(taken: Taken, zones: ReadonlyArray<Vector3>, x: number, z: number): boolean {
	return (
		x >= 0 &&
		z >= 0 &&
		x < GRID_SIZE &&
		z < GRID_SIZE &&
		!taken.has(cellIndex(x, z)) &&
		!inDropZone(cellIndex(x, z), 1, zones)
	);
}

/**
 * A line that a single drag from `start` to `end` lays, as short as there is, from the `starts` to the cells
 * beside `target`: nothing in its way, its last belt facing into `target` and its first not into `source`.
 */
function drag(source: Model, target: Model, starts: Starts, taken: Taken, zones: ReadonlyArray<Vector3>) {
	const ends = around(target).filter(([x, z]) => free(taken, zones, x, z));
	let best: Array<Placement> | undefined;
	for (const [sx, sz] of starts) {
		if (!free(taken, zones, sx, sz)) continue;
		for (const [ex, ez] of ends) {
			// One cell has no way to face but the one given.
			for (let rotation = 0; rotation < (sx === ex && sz === ez ? 4 : 1); rotation++) {
				const line = lineBetween([sx, sz], [ex, ez], rotation, true);
				if (best && line.size() >= best.size()) continue;
				const first = line[0];
				const last = line[line.size() - 1];
				const [fx, fz] = DIRECTIONS[first.rotation];
				const [lx, lz] = DIRECTIONS[last.rotation];
				if (
					last.x === ex &&
					last.z === ez &&
					line.size() <= MAX_LINE &&
					line.every(({ x, z }) => free(taken, zones, x, z)) &&
					modelOn(taken, last.x + lx, last.z + lz) === target &&
					modelOn(taken, first.x + fx, first.z + fz) !== source
				) {
					best = line;
				}
			}
		}
	}
	return best;
}

/** A path round whatever is in the way, from the `starts` to beside `target`. It takes several drags. */
function route(target: Model, starts: Starts, taken: Taken, zones: ReadonlyArray<Vector3>) {
	const before = new Map<number, number>();
	const queue = new Array<number>();
	for (const [x, z] of starts) {
		if (!free(taken, zones, x, z)) continue;
		before.set(cellIndex(x, z), -1);
		queue.push(cellIndex(x, z));
	}
	// A while: roblox-ts compiles this `for` to a numeric for that never sees the queue grow.
	let head = 0;
	while (head < queue.size()) {
		const cell = queue[head++];
		const [x, z] = cellCoords(cell);
		const into = DIRECTIONS.findIndex(([dx, dz]) => modelOn(taken, x + dx, z + dz) === target);
		if (into >= 0) {
			const path = new Array<number>();
			for (let at: number | undefined = cell; at !== undefined && at !== -1; at = before.get(at)) path.push(at);
			// Each belt faces the one after it, the last into the target.
			return path.map((_, i): Placement => {
				const [cx, cz] = cellCoords(path[path.size() - 1 - i]);
				const onward = path[path.size() - 2 - i];
				const [nx, nz] = onward !== undefined ? cellCoords(onward) : [cx, cz];
				return { x: cx, z: cz, rotation: onward !== undefined ? directionOf(nx - cx, nz - cz)! : into };
			});
		}
		for (const [dx, dz] of DIRECTIONS) {
			if (!free(taken, zones, x + dx, z + dz) || before.has(cellIndex(x + dx, z + dz))) continue;
			before.set(cellIndex(x + dx, z + dz), cell);
			queue.push(cellIndex(x + dx, z + dz));
		}
	}
	return undefined;
}

/** Where the ore of `source` goes: for each belt chain it feeds, the cell after its last belt and what is on it. */
function chains(source: Model, taken: Taken) {
	const ends = new Array<{ x: number; z: number; into: Model | undefined; belts: number }>();
	for (const [x, z] of around(source)) {
		const visited = new Set<Model>();
		let model = modelOn(taken, x, z);
		let [dx, dz] = [0, 0];
		let [ax, az] = [x, z];
		while (model && !visited.has(model)) {
			// A belt turns it; a junction, which the server swaps a crossed belt for, sends it straight on.
			if (isBeltModel(model)) [dx, dz] = DIRECTIONS[model.GetAttribute("Rotation") as number];
			else if (visited.isEmpty() || (model as Model).GetAttribute("Kind") !== "junction") break;
			visited.add(model);
			const [bx, bz] = cellCoords(model.GetAttribute("Cell") as number);
			[ax, az] = [bx + dx, bz + dz];
			model = modelOn(taken, ax, az);
			// A belt facing into the source doesn't carry from it.
			if (visited.size() === 1 && model === source) visited.clear();
		}
		if (!visited.isEmpty()) ends.push({ x: ax, z: az, into: model, belts: visited.size() });
	}
	return ends;
}

/** The last `planBelt`, until the buildings or planet change, or it is asked for another pair. */
let planned:
	| {
			source: Model;
			target: Model;
			taken: Taken;
			planet: number | undefined;
			plan?: { line: Array<Placement>; single: boolean };
	  }
	| undefined;

/**
 * The belts to lay from `source` to `target`, first to last, from the end of the belt chain `source` already feeds
 * if it has one: one drag's worth if there is one (`single`, see `drag`), else a path round what is in the way.
 * Undefined with no way through.
 * ponytail: ignores liquid (the server refuses belts on it); a map with a lake in the way needs the ground read.
 */
export function planBelt(source: Model, target: Model) {
	const taken = occupancy();
	const state = baseStateAtom();
	const planet = state?.planet;
	if (
		planned?.source === source &&
		planned.target === target &&
		planned.taken === taken &&
		planned.planet === planet
	) {
		return planned.plan;
	}
	const zones = state?.dropZones ?? [];
	const open = chains(source, taken).find((tail) => tail.into === undefined && free(taken, zones, tail.x, tail.z));
	const starts: Starts = open ? [[open.x, open.z]] : around(source).map(([x, z]): [number, number] => [x, z]);
	const line = drag(source, target, starts, taken, zones);
	const found = line ?? route(target, starts, taken, zones);
	planned = { source, target, taken, planet, plan: found && { line: found, single: line !== undefined } };
	return planned.plan;
}

/** Whether ore from `source` reaches `target`: by it being next to it, or riding belts into it. */
export function beltReaches(source: Model, target: Model): boolean {
	const taken = occupancy();
	return (
		around(source).some(([x, z]) => modelOn(taken, x, z) === target) ||
		chains(source, taken).some((tail) => tail.into === target)
	);
}

/** The copper deposit with no building on it that is nearest `near`. */
export function freeOre(near: Vector3): Model | undefined {
	const taken = occupancy();
	let best: Model | undefined;
	let bestDistance = math.huge;
	for (const ore of CollectionService.GetTagged("Ore")) {
		const cell = ore.GetAttribute("Cell");
		if (
			!ore.IsA("Model") ||
			ore.GetAttribute("Resource") !== "copper" ||
			!typeIs(cell, "number") ||
			taken.has(cell)
		) {
			continue;
		}
		const distance = ore.GetPivot().Position.sub(near).Magnitude;
		if (distance < bestDistance) [best, bestDistance] = [ore, distance];
	}
	return best;
}

/**
 * The cell for a first turret by `core`: a few cells out from its edge toward the nearest drop zone, snapped to the
 * nearest free cell. Undefined with no drop zone.
 * ponytail: aliens walk a server flowfield, so a straight line to the zone only approximates where they come from.
 */
export function turretSpot(core: Model): number | undefined {
	const taken = occupancy();
	const zones = baseStateAtom()?.dropZones ?? [];
	const [cx, cz, size] = footprintOf(core);
	const centre = cellCenter(cellIndex(cx, cz), size);
	const zone = nearestZone(zones, centre);
	if (!zone) return undefined;
	const zoneDistance = new Vector3(zone.X - centre.X, 0, zone.Z - centre.Z).Magnitude;
	if (zoneDistance === 0) return undefined;
	const reach = (size / 2 + TURRET_CELLS) * CELL_STUDS;
	const aim = new Vector3(
		centre.X + ((zone.X - centre.X) / zoneDistance) * reach,
		0,
		centre.Z + ((zone.Z - centre.Z) / zoneDistance) * reach,
	);
	const [ax, az] = cellCoords(cellAt(aim.X, aim.Z) ?? cellIndex(cx, cz));
	for (let ring = 0; ring <= SPOT_RINGS; ring++) {
		let best: number | undefined;
		let bestDistance = math.huge;
		for (let dz = -ring; dz <= ring; dz++) {
			for (let dx = -ring; dx <= ring; dx++) {
				if (math.max(math.abs(dx), math.abs(dz)) !== ring || !free(taken, zones, ax + dx, az + dz)) continue;
				if (dx * dx + dz * dz < bestDistance)
					[best, bestDistance] = [cellIndex(ax + dx, az + dz), dx * dx + dz * dz];
			}
		}
		if (best !== undefined) return best;
	}
	return undefined;
}

let folder: Folder | undefined;
/** A tile and a chevron's two bars for each cell of the line drawn, and the pad of a spot. */
let tiles = new Array<[Part, Part, Part]>();
let pad: Part | undefined;
/** What is drawn, as `lineKey` or `spot` tells it, so the same again costs nothing. */
let drawn: string | undefined;
const ground = new RaycastParams();
ground.FilterType = Enum.RaycastFilterType.Include;
ground.IgnoreWater = true;

function layer(): Folder {
	if (folder) return folder;
	folder = new Instance("Folder");
	folder.Name = "TutorialGuide";
	folder.Parent = Workspace;
	return folder;
}

/** The height of the ground at (x, z), or undefined where it isn't there (yet). */
export function groundAt(x: number, z: number): number | undefined {
	ground.FilterDescendantsInstances = [Workspace.Terrain];
	const down = new Vector3(0, -2 * GROUND_SEARCH, 0);
	return Workspace.Raycast(new Vector3(x, GROUND_SEARCH, z), down, ground)?.Position.Y;
}

/** The highest ground across a cell, so its tile doesn't sink into a slope. */
function topOf(centre: Vector3): number {
	let high = -math.huge;
	for (const [dx, dz] of [
		[0, 0],
		[-1, -1],
		[1, -1],
		[-1, 1],
		[1, 1],
	]) {
		high = math.max(high, groundAt(centre.X + (dx * CELL_STUDS) / 2.5, centre.Z + (dz * CELL_STUDS) / 2.5) ?? 0);
	}
	return high;
}

/** Lays a flat glowing tile on a cell and returns where its top is. */
function lay(part: Part, cell: number, color: Color3): Vector3 {
	const centre = cellCenter(cell);
	const top = new Vector3(centre.X, topOf(centre) + TILE_LIFT, centre.Z);
	part.Size = new Vector3(CELL_STUDS - 1, TILE_THICKNESS, CELL_STUDS - 1);
	part.Position = top;
	part.Color = color;
	part.Transparency = GUIDE_TRANSPARENCY;
	return top.add(new Vector3(0, TILE_THICKNESS / 2 + 0.1, 0));
}

/** Hides the parts of a line and the pad. */
function hideAll() {
	for (const parts of tiles) for (const part of parts) part.Transparency = 1;
	if (pad) pad.Transparency = 1;
}

/**
 * Shows a belt line as glowing tiles on the ground, each with a chevron the way it faces: the first in the accent
 * colour, the last blue. Parts are made once and moved, and the same line again does nothing.
 * Returns the first tile, for the hint to point at.
 */
export function drawLine(line: ReadonlyArray<Placement>): BasePart {
	const key = line.map(({ x, z, rotation }) => `${x},${z},${rotation}`).join(";");
	if (key !== drawn || tiles.isEmpty()) {
		drawn = key;
		hideAll();
		line.forEach(({ x, z, rotation }, index) => {
			const parts = tiles[index] ?? [0, 1, 2].map(() => ghostPart(layer(), Vector3.one));
			tiles[index] = parts as [Part, Part, Part];
			const [tile, left, right] = parts;
			const last = index === line.size() - 1;
			const top = lay(tile, cellIndex(x, z), index === 0 ? COLORS.accent : last ? END_COLOR : COLORS.confirm);
			const [dx, dz] = DIRECTIONS[rotation];
			chevronBars(CFrame.lookAt(top, top.add(new Vector3(dx, 0, dz)))).forEach((bar, i) => {
				const part = i === 0 ? left : right;
				part.Size = CHEVRON;
				part.CFrame = bar;
				part.Color = COLORS.text;
				part.Transparency = 0.1;
			});
		});
	}
	return tiles[0][0];
}

/** Shows a single glowing pad on `cell`, as `drawLine` does a line, and returns it. */
export function drawSpot(cell: number): BasePart {
	const key = `spot ${cell}`;
	pad ??= ghostPart(layer(), Vector3.one);
	if (key !== drawn) {
		drawn = key;
		hideAll();
		lay(pad, cell, COLORS.accent);
	}
	return pad;
}

/** Takes the guide off the ground. */
export function clearGuide() {
	if (!folder) return;
	folder.Destroy();
	[folder, pad, drawn] = [undefined, undefined, undefined];
	tiles = [];
}
