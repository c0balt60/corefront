import { BUILDINGS, type BuildingKind } from "game/Base/shared/buildings";
import { CELL_STUDS, cellCenter } from "game/Terrain/shared/map";

/*
 * Belt geometry and timing, shared so clients preview and animate exactly what the server runs.
 * Sides and rotations are the same numbers: quarter turns, each the way a building turned that
 * far faces (its LookVector), as steps across the grid.
 */
export const DIRECTIONS: ReadonlyArray<readonly [dx: number, dz: number]> = [
	[0, -1],
	[-1, 0],
	[0, 1],
	[1, 0],
];

/** The side a one-cell step of (dx, dz) heads toward, or undefined for anything else. */
export function directionOf(dx: number, dz: number): number | undefined {
	const side = DIRECTIONS.findIndex(([x, z]) => x === dx && z === dz);
	return side >= 0 ? side : undefined;
}

/** Cells per second ore rides a belt. */
export const BELT_SPEED = 1.25;
/** How close ore rides behind the ore ahead, as a share of a belt: at most 4 fit on one. */
export const BELT_SPACING = 0.3;
/** A belt's width in studs, rails aside. */
export const BELT_WIDTH = 5;
/** How far a belt's surface stands above the highest ground across it. */
const BELT_LIFT = 0.6;
/** The steepest a belt climbs or drops, as rise over run: about 20°. */
const GRADE = math.tan(math.rad(20));
/** The terrain's grid: its ground is a blend between heights this far apart. A cell spans two. */
const GROUND_STEP = CELL_STUDS / 2;
/** Straight pieces a straight belt, and a corner's curve, are drawn with. */
const STRAIGHT_PIECES = 4;
const CORNER_PIECES = 6;
/** How far a belt feeding another from the side reaches past its own cell: up to the other's surface. */
const TAIL = CELL_STUDS / 2 - BELT_WIDTH / 2 - 0.05;

/** Whether a building of `kind` facing `rotation`, on `side` of a belt, puts ore onto it. */
export function feedsBelt(kind: BuildingKind, rotation: number, side: number): boolean {
	return kind === "conveyor" ? rotation === (side + 2) % 4 : BUILDINGS[kind].outputs === true;
}

/**
 * The side a belt facing `rotation` takes ore in at the start of its path, given which of its
 * sides are fed: its back when fed there, the one fed side when only one is (a corner), else its back.
 */
export function entryOf(rotation: number, fed: (side: number) => boolean): number {
	const back = (rotation + 2) % 4;
	if (fed(back)) return back;
	const sides = [(rotation + 1) % 4, (rotation + 3) % 4].filter(fed);
	return sides.size() === 1 ? sides[0] : back;
}

/**
 * The way ore rides a belt: in at the middle of its entry side, round by its centre, out the
 * middle of its front. Its heights are the control points of a smooth curve, with `ends` those
 * of the points before and after it (X behind, Y ahead), so it bends into its neighbours with no kink.
 */
export type BeltPath = readonly [from: Vector3, middle: Vector3, to: Vector3, ends: Vector2];
/** A straight piece of a belt: a frame halfway along it looking ahead (-Z), and its length. */
export type BeltRun = readonly [frame: CFrame, length: number];
/** A belt as `runPaths` lays it out. */
export interface RunBelt {
	readonly cell: number;
	readonly rotation: number;
	readonly entry: number;
}

/**
 * The paths of a run of belts, first to last, each handing its ore on to the next by that one's
 * entry. They clear the highest ground across them, but never climb or drop more steeply than
 * `GRADE`: where the ground does, the belt ramps early and stands on its supports instead.
 * Corners stay level. The last, feeding another belt from the side, comes up to `merge`, that
 * one's height. `groundAt` only has to be right on the terrain's grid points.
 */
export function runPaths(
	run: ReadonlyArray<RunBelt>,
	groundAt: (x: number, z: number) => number,
	merge?: number,
): Array<BeltPath> {
	// The highest ground on the line through `point` square to `side`, a grid step either way.
	const across = (point: Vector3, side: number) => {
		const [dx, dz] = DIRECTIONS[side];
		return math.max(
			groundAt(point.X, point.Z),
			groundAt(point.X + dz * GROUND_STEP, point.Z + dx * GROUND_STEP),
			groundAt(point.X - dz * GROUND_STEP, point.Z - dx * GROUND_STEP),
		);
	};
	// The highest ground anywhere on a cell, which a corner's curve cuts across.
	const top = (center: Vector3) => {
		let high = -math.huge;
		for (let dz = -1; dz <= 1; dz++) {
			for (let dx = -1; dx <= 1; dx++) {
				high = math.max(high, groundAt(center.X + dx * GROUND_STEP, center.Z + dz * GROUND_STEP));
			}
		}
		return high;
	};

	// Every point the run passes, the least height there, and how far it is on to the next.
	const points = new Array<Vector3>();
	const heights = new Array<number>();
	const spans = new Array<number>();
	run.forEach(({ cell, rotation, entry }, index) => {
		const center = cellCenter(cell);
		const edge = (side: number) =>
			center.add(new Vector3(DIRECTIONS[side][0] * GROUND_STEP, 0, DIRECTIONS[side][1] * GROUND_STEP));
		const corner = entry !== (rotation + 2) % 4;
		if (index === 0) {
			points.push(edge(entry));
			heights.push(across(edge(entry), entry) + BELT_LIFT);
		}
		points.push(center, edge(rotation));
		heights.push((corner ? top(center) : across(center, rotation)) + BELT_LIFT);
		heights.push(across(edge(rotation), rotation) + BELT_LIFT);
		// A corner has no length to climb in, so it's level.
		const span = corner ? 0 : GROUND_STEP;
		spans.push(span, span);
	});
	const last = heights.size() - 1;
	if (merge !== undefined) heights[last] = math.max(heights[last], merge);
	// Raised wherever the next point or the last is too high to reach at the grade.
	for (let i = 1; i <= last; i++) heights[i] = math.max(heights[i], heights[i - 1] - GRADE * spans[i - 1]);
	for (let i = last - 1; i >= 0; i--) heights[i] = math.max(heights[i], heights[i + 1] - GRADE * spans[i]);

	const at = (i: number) => new Vector3(points[i].X, heights[i], points[i].Z);
	return run.map((_, index) => {
		const i = index * 2;
		// Past the ends of the run, the curve carries straight on.
		const behind = i > 0 ? heights[i - 1] : 2 * heights[i] - heights[i + 1];
		const ahead = i + 3 <= last ? heights[i + 3] : 2 * heights[i + 2] - heights[i + 1];
		return [at(i), at(i + 1), at(i + 2), new Vector2(behind, ahead)];
	});
}

/** Whether a belt's path turns: it comes in and goes out by sides at right angles. */
export function isCorner(path: BeltPath): boolean {
	const [from, , to] = path;
	return math.abs(from.X - to.X) > 0.01 && math.abs(from.Z - to.Z) > 0.01;
}

/**
 * How high a path is `t` of the way along it (0 at its entry, 1 at its front). Each control point
 * rules the stretch round it, a quarter of the belt either way, as a quadratic B-spline: the
 * curve runs through the halfway marks between them and eases round each one.
 */
function heightOn(path: BeltPath, t: number): number {
	const [from, middle, to, ends] = path;
	const controls = [ends.X, from.Y, middle.Y, to.Y, ends.Y];
	const index = math.clamp(math.floor((t + 0.25) * 2), 0, 2);
	const u = (t + 0.25) * 2 - index;
	const [before, own, after] = [controls[index], controls[index + 1], controls[index + 2]];
	return (1 - u) ** 2 * ((before + own) / 2) + 2 * u * (1 - u) * own + u ** 2 * ((own + after) / 2);
}

/**
 * The point `t` of the way along a path, `offset` studs right of its middle. A corner's curve is a
 * quarter circle round the cell corner between its two sides.
 */
export function pointOn(path: BeltPath, t: number, offset: number): Vector3 {
	const [from, middle, to] = path;
	let flat: Vector3;
	if (isCorner(path)) {
		const radius = CELL_STUDS / 2;
		const pivot = new Vector3(from.X + to.X - middle.X, 0, from.Z + to.Z - middle.Z);
		const toEntry = new Vector3(from.X - pivot.X, 0, from.Z - pivot.Z).div(radius);
		const toFront = new Vector3(to.X - pivot.X, 0, to.Z - pivot.Z).div(radius);
		// Right of the way it heads is away from the pivot on a left turn, toward it on a right one.
		const outward = toFront.X * toEntry.Z - toFront.Z * toEntry.X;
		const reach = radius + outward * offset;
		const angle = (t * math.pi) / 2;
		flat = pivot.add(toEntry.mul(math.cos(angle) * reach)).add(toFront.mul(math.sin(angle) * reach));
	} else {
		const ahead = new Vector3(to.X - from.X, 0, to.Z - from.Z);
		const right = new Vector3(-ahead.Z, 0, ahead.X).Unit;
		flat = new Vector3(from.X, 0, from.Z).add(ahead.mul(t)).add(right.mul(offset));
	}
	return new Vector3(flat.X, heightOn(path, t), flat.Z);
}

/**
 * The straight pieces a belt is drawn with, `offset` studs right of its middle (where its rails
 * go), following its curve. With a `tail`, a last level piece reaches on into the belt it feeds
 * from the side.
 */
export function beltRuns(path: BeltPath, offset = 0, tail = false): Array<BeltRun> {
	const run = (from: Vector3, to: Vector3): BeltRun => [
		CFrame.lookAt(from.add(to).div(2), to),
		to.sub(from).Magnitude,
	];
	const pieces = isCorner(path) ? CORNER_PIECES : STRAIGHT_PIECES;
	const runs = new Array<BeltRun>();
	for (let i = 0; i < pieces; i++) {
		runs.push(run(pointOn(path, i / pieces, offset), pointOn(path, (i + 1) / pieces, offset)));
	}
	if (tail) {
		const [, middle, to] = path;
		const front = pointOn(path, 1, offset);
		runs.push(run(front, front.add(new Vector3(to.X - middle.X, 0, to.Z - middle.Z).Unit.mul(TAIL))));
	}
	return runs;
}

/** Where ore is `progress` along a path (0 at its start, 1 at its end), and which way it's heading. */
export function alongPath(path: BeltPath, progress: number): [position: Vector3, heading: Vector3] {
	const behind = pointOn(path, math.max(progress - 0.02, 0), 0);
	const ahead = pointOn(path, math.min(progress + 0.02, 1), 0);
	return [pointOn(path, progress, 0), ahead.sub(behind)];
}

/** Where a belt's chevron lies: three quarters of the way along, looking ahead. */
export function chevronRun(path: BeltPath): CFrame {
	return CFrame.lookAt(pointOn(path, 0.75, 0), pointOn(path, 0.8, 0));
}

/** The two bars of a chevron lying on a belt run (see `beltRuns`), pointing the way it carries. */
export function chevronBars(run: CFrame): [CFrame, CFrame] {
	// Each bar runs from a back corner in to the tip, 0.6 across for every 0.8 along.
	const angle = math.atan2(0.6, 0.8);
	const bar = (side: number) => run.mul(new CFrame(side * 0.45, 0.05, 0)).mul(CFrame.Angles(0, side * angle, 0));
	return [bar(-1), bar(1)];
}

/** A belt's path, from the attributes the server gives its model. */
export function modelPath(model: Instance): BeltPath | undefined {
	const from = model.GetAttribute("PathIn");
	const middle = model.GetAttribute("PathMid");
	const to = model.GetAttribute("PathOut");
	const ends = model.GetAttribute("PathEnds");
	if (!typeIs(from, "Vector3") || !typeIs(middle, "Vector3") || !typeIs(to, "Vector3") || !typeIs(ends, "Vector2")) {
		return undefined;
	}
	return [from, middle, to, ends];
}
