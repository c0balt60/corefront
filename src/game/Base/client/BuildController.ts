import { Controller, OnStart } from "@flamework/core";
import { computed, effect, untracked } from "@rbxts/charm";
import { CollectionService, RunService, UserInputService, Workspace } from "@rbxts/services";

import { CharacterController } from "core/Character/client/CharacterController";
import { COLORS } from "core/Interface/client/theme";
import {
	amountOf,
	baseStateAtom,
	type BuildMode,
	buildModeAtom,
	equippedAtom,
	toggleBuildMode,
} from "game/Base/client/base-state";
import { BaseMessage, baseMessaging, type Placement } from "game/Base/shared/base-network";
import {
	alongPath,
	BELT_WIDTH,
	type BeltPath,
	beltRuns,
	chevronBars,
	chevronRun,
	DIRECTIONS,
	directionOf,
	entryOf,
	feedsBelt,
	modelPath,
	type RunBelt,
	runPaths,
} from "game/Base/shared/belts";
import {
	BUILD_RANGE,
	BUILD_TOOL,
	type BuildableKind,
	BUILDABLE,
	BUILDINGS,
	type BuildingKind,
	inDropZone,
	isBelt,
	MAX_LINE,
	replaces,
} from "game/Base/shared/buildings";
import type { ResourceId } from "game/Base/shared/resources";
import { deployedAtom } from "game/Planets/client/planets-state";
import { levelsAtom } from "game/Research/client/research-state";
import { canBuild } from "game/Research/shared/research";
import { CELL_STUDS, cellAt, cellCenter, cellCoords, cellIndex, GRID_SIZE } from "game/Terrain/shared/map";

const RAY_LENGTH = 1000;
/** How far above and below a point to look for the ground under it. */
const GROUND_SEARCH = 500;
const GHOST_TRANSPARENCY = 0.55;
const RING_TRANSPARENCY = 0.85;
const CHEVRON = new Vector3(0.35, 0.15, 1);

/** Every building's model, by each cell it covers. */
function occupancy(): Map<number, Model> {
	const taken = new Map<number, Model>();
	const buildings = Workspace.FindFirstChild("Base")?.FindFirstChild("Buildings");
	for (const model of buildings?.GetChildren() ?? []) {
		const cell = model.GetAttribute("Cell");
		const kind = model.GetAttribute("Kind");
		if (!model.IsA("Model") || !typeIs(cell, "number") || !typeIs(kind, "string")) continue;
		const [x, z] = cellCoords(cell);
		const span = BUILDINGS[kind as BuildingKind]?.size ?? 1;
		for (let dz = 0; dz < span; dz++) {
			for (let dx = 0; dx < span; dx++) taken.set(cellIndex(x + dx, z + dz), model);
		}
	}
	return taken;
}

/** The building covering cell (x, z), if any. */
function modelOn(taken: ReadonlyMap<number, Model>, x: number, z: number): Model | undefined {
	if (x < 0 || z < 0 || x >= GRID_SIZE || z >= GRID_SIZE) return undefined;
	return taken.get(cellIndex(x, z));
}

/** The building covering the cell under a world point, if any. */
function buildingAt(point: Vector3, taken = occupancy()) {
	const cell = cellAt(point.X, point.Z);
	return cell !== undefined ? taken.get(cell) : undefined;
}

/** The building under the mouse, unless terrain is in the way. */
function buildingUnderMouse(): Model | undefined {
	const camera = Workspace.CurrentCamera;
	const buildings = Workspace.FindFirstChild("Base")?.FindFirstChild("Buildings");
	if (!camera || !buildings) return undefined;
	const mouse = UserInputService.GetMouseLocation();
	const ray = camera.ViewportPointToRay(mouse.X, mouse.Y);
	const params = new RaycastParams();
	params.FilterType = Enum.RaycastFilterType.Include;
	params.FilterDescendantsInstances = [Workspace.Terrain, buildings];
	const hit = Workspace.Raycast(ray.Origin, ray.Direction.mul(RAY_LENGTH), params);
	// Just inside whatever was hit, so a building's side counts as its own cell, not its neighbour's.
	return hit && buildingAt(hit.Position.sub(hit.Normal.mul(0.5)));
}

/**
 * What the mouse points at: a building, or else a tree, rock or ore (the whole of it, like the
 * server clears it) and the cell under the point. Terrain in front hides both.
 */
export function pointedAt(taken = occupancy()): { building?: Model; prop?: Instance; cell?: number } {
	const camera = Workspace.CurrentCamera;
	if (!camera) return {};
	const buildings = Workspace.FindFirstChild("Base")?.FindFirstChild("Buildings");
	const props = Workspace.FindFirstChild("PlanetProps");
	const filter: Array<Instance> = [Workspace.Terrain];
	if (buildings) filter.push(buildings);
	if (props) filter.push(props);
	const params = new RaycastParams();
	params.FilterType = Enum.RaycastFilterType.Include;
	params.FilterDescendantsInstances = filter;
	const mouse = UserInputService.GetMouseLocation();
	const ray = camera.ViewportPointToRay(mouse.X, mouse.Y);
	const hit = Workspace.Raycast(ray.Origin, ray.Direction.mul(RAY_LENGTH), params);
	if (!hit) return {};
	// Just inside whatever was hit, so a building's side counts as its own cell, not its neighbour's.
	const inside = hit.Position.sub(hit.Normal.mul(0.5));
	const building = buildingAt(inside, taken);
	if (building || !props || !hit.Instance.IsDescendantOf(props)) return { building };
	const parent = hit.Instance.FindFirstAncestorOfClass("Model");
	return { prop: parent && parent.IsDescendantOf(props) ? parent : hit.Instance, cell: cellAt(inside.X, inside.Z) };
}

/** Whether `model`, on `side` of a belt, puts ore onto it (see `feedsBelt`). */
function feeds(model: Model | undefined, side: number): boolean {
	const kind = model?.GetAttribute("Kind");
	const facing = model?.GetAttribute("Rotation");
	return typeIs(kind, "string") && typeIs(facing, "number") && feedsBelt(kind as BuildingKind, facing, side);
}

/** Whether `model` is a belt. */
function isBeltModel(model: Model | undefined): model is Model {
	const kind = model?.GetAttribute("Kind");
	return typeIs(kind, "string") && BUILDINGS[kind as BuildingKind]?.belt !== undefined;
}

/** Whether `model` is a straight belt running across a belt line heading `rotation`: the server lays a Junction there. */
function crossable(model: Model | undefined, rotation: number): boolean {
	const facing = model?.GetAttribute("Rotation");
	if (!isBeltModel(model) || !typeIs(facing, "number")) return false;
	return facing % 2 !== rotation % 2 && model.GetAttribute("Entry") === (facing + 2) % 4;
}

/** The middle height of belt `ahead`, if a belt heading `rotation` feeds it from the side (see `runPaths`). */
function mergeHeight(ahead: Model | undefined, rotation: number): number | undefined {
	const back = (rotation + 2) % 4;
	const path = ahead && modelPath(ahead);
	if (!isBeltModel(ahead) || !path) return undefined;
	const side = ahead.GetAttribute("Rotation") === back || ahead.GetAttribute("Entry") === back;
	return side ? undefined : alongPath(path, 0.5)[0].Y;
}

/**
 * The paths a belt line's belts will take, as the server lays them out: in runs, each belt taking
 * its ore from the one before or whatever else feeds it. With each, whether it reaches on into a
 * belt it feeds from the side. None where the line crosses a belt.
 */
function linePaths(
	line: ReadonlyArray<Placement>,
	crossings: ReadonlyArray<boolean>,
	taken: ReadonlyMap<number, Model>,
	groundAt: (x: number, z: number) => number,
): Array<readonly [path: BeltPath, tail: boolean] | undefined> {
	const paths = new Array<readonly [path: BeltPath, tail: boolean] | undefined>();
	let run = new Array<RunBelt>();
	let first = 0;
	const finish = (index: number) => {
		if (run.isEmpty()) return;
		const { x, z, rotation } = line[index];
		const [dx, dz] = DIRECTIONS[rotation];
		const merge = crossings[index + 1] ? undefined : mergeHeight(modelOn(taken, x + dx, z + dz), rotation);
		const last = run.size() - 1;
		runPaths(run, groundAt, merge).forEach(
			(path, i) => (paths[first + i] = [path, i === last && merge !== undefined]),
		);
		run = [];
	};
	line.forEach(({ x, z, rotation }, index) => {
		if (crossings[index]) return finish(index - 1);
		const previous = line[index - 1];
		const behind = previous && directionOf(previous.x - x, previous.z - z);
		const entry = entryOf(rotation, (side) => {
			const [dx, dz] = DIRECTIONS[side];
			return side !== rotation && (side === behind || feeds(modelOn(taken, x + dx, z + dz), side));
		});
		if (entry !== behind) finish(index - 1);
		if (run.isEmpty()) first = index;
		run.push({ cell: cellIndex(x, z), rotation, entry });
	});
	finish(line.size() - 1);
	return paths;
}

/**
 * The cells from `from` to `to` as an L, the longer way first, at most `MAX_LINE` of them. Belts
 * (`directed`) each face the next cell, the last on the way the line runs; anything else faces `rotation`.
 */
function lineBetween(
	from: readonly [number, number],
	to: readonly [number, number],
	rotation: number,
	directed: boolean,
): Array<Placement> {
	const [x1, z1] = to;
	let [x, z] = from;
	const cells: Array<[number, number]> = [[x, z]];
	const walkX = () => {
		while (x !== x1) {
			x += math.sign(x1 - x);
			cells.push([x, z]);
		}
	};
	const walkZ = () => {
		while (z !== z1) {
			z += math.sign(z1 - z);
			cells.push([x, z]);
		}
	};
	if (math.abs(x1 - x) >= math.abs(z1 - z)) {
		walkX();
		walkZ();
	} else {
		walkZ();
		walkX();
	}
	const line = cells.filter((_, index) => index < MAX_LINE);
	return line.map(([cx, cz], index) => {
		if (!directed || line.size() === 1) return { x: cx, z: cz, rotation };
		const last = index === line.size() - 1;
		const [ax, az] = last ? line[index - 1] : [cx, cz];
		const [bx, bz] = last ? [cx, cz] : line[index + 1];
		return { x: cx, z: cz, rotation: directionOf(bx - ax, bz - az) ?? rotation };
	});
}

/** A local, non-colliding part for the ghost. Hidden until the first frame places it. */
function ghostPart(parent: Instance, size: Vector3, shape: Enum.PartType = Enum.PartType.Block) {
	const part = new Instance("Part");
	part.Anchored = true;
	part.CanCollide = false;
	part.CanQuery = false;
	part.CanTouch = false;
	part.CastShadow = false;
	part.Material = Enum.Material.Neon;
	part.Shape = shape;
	part.Size = size;
	part.Transparency = 1;
	part.Parent = parent;
	return part;
}

/**
 * Building and removing, while the local player has the Build tool out on a
 * planet with the base running. A build bar card picks a building, or F the
 * remove tool; picking the same again puts it down, and so does putting the
 * Build tool away. A building shows as a ghost on the cell under the mouse,
 * green where the server should accept it and red where it won't; R turns it
 * and a click asks the server to build it. Dragging lays a line of one-cell
 * buildings. Belts in it face along it and preview as they'll be built: tilted
 * with the ground, curving where it turns or out of whatever feeds them, and
 * merging into a belt they run into, with a Junction where they cross one.
 * The remove tool outlines the building under the mouse in red, or else the
 * tree or rock, and a click asks to remove it. With no building picked, R turns
 * the building under the mouse and Q picks it to build, facing the same way.
 */
@Controller()
export class BuildController implements OnStart {
	/** Quarter turns, kept between buildings: the way a click places, and a line of anything but belts. */
	private rotation = 0;

	constructor(private readonly characterController: CharacterController) {}

	onStart() {
		// ponytail: keyboard and mouse only; touch needs on-screen place, rotate and cancel buttons and a tap to aim.
		const enabled = computed(
			() => deployedAtom() && baseStateAtom()?.phase === "active" && equippedAtom()?.Name === BUILD_TOOL,
		);
		effect(() => {
			if (!enabled()) buildModeAtom(undefined);
		});
		effect(() => {
			const mode = buildModeAtom();
			if (mode === undefined) return;
			return untracked(() => this.run(mode));
		});

		UserInputService.InputBegan.Connect((input, processed) => {
			if (processed || !enabled() || UserInputService.GetFocusedTextBox()) return;
			if (input.KeyCode === Enum.KeyCode.F) {
				toggleBuildMode("remove");
			} else if (input.KeyCode === Enum.KeyCode.Q) {
				this.pick();
			} else if (input.KeyCode === Enum.KeyCode.R) {
				// R turns the ghost while there is one, and otherwise the building under the mouse.
				const mode = buildModeAtom();
				if (mode !== undefined && mode !== "remove") this.rotation = (this.rotation + 1) % 4;
				else this.turnHovered();
			}
		});
	}

	/** Picks the building under the mouse to build, facing the same way, if the local player can build it. */
	private pick() {
		const model = buildingUnderMouse();
		const kind = model?.GetAttribute("Kind") as BuildableKind | undefined;
		const sandbox = baseStateAtom()?.sandbox;
		if (!model || kind === undefined || !BUILDABLE.includes(kind) || !canBuild(levelsAtom(), kind, sandbox)) return;
		const rotation = model.GetAttribute("Rotation");
		if (typeIs(rotation, "number")) this.rotation = rotation;
		buildModeAtom(kind);
	}

	/** Asks the server to turn the building under the mouse a quarter turn. */
	private turnHovered() {
		const cell = buildingUnderMouse()?.GetAttribute("Cell");
		if (!typeIs(cell, "number")) return;
		const [x, z] = cellCoords(cell);
		baseMessaging.server.emit(BaseMessage.Rotate, { x, z });
	}

	/** Puts the ghosts or the remove outline under the mouse until the returned cleanup runs. */
	private run(mode: BuildMode) {
		const kind = mode === "remove" ? undefined : mode;
		const def = kind ? BUILDINGS[kind] : undefined;
		const size = def ? def.size : 1;
		const belt = kind !== undefined && isBelt(kind);
		// Ore never moves, so where it is can be read once.
		const ores = new Set(CollectionService.GetTagged("Ore").map((ore) => ore.GetAttribute("Cell")));

		const folder = new Instance("Folder");
		folder.Name = "BuildGhost";
		// One set of parts per cell of the line, as many as what goes there takes to draw.
		const ghosts = new Array<Array<Part>>();
		const partsFor = (index: number, count: number) => {
			const parts = ghosts[index] ?? [];
			ghosts[index] = parts;
			while (parts.size() < count) parts.push(ghostPart(folder, Vector3.one));
			parts.forEach((part, i) => {
				if (i >= count) part.Transparency = 1;
			});
			return parts;
		};
		const ring =
			def?.range !== undefined
				? ghostPart(folder, new Vector3(0.2, def.range * 2, def.range * 2), Enum.PartType.Cylinder)
				: undefined;
		const highlight = new Instance("Highlight");
		highlight.Enabled = false;
		highlight.FillColor = COLORS.danger;
		highlight.FillTransparency = 0.5;
		highlight.OutlineColor = COLORS.danger;
		highlight.Parent = folder;
		folder.Parent = Workspace;

		const terrain = new RaycastParams();
		terrain.FilterType = Enum.RaycastFilterType.Include;
		terrain.FilterDescendantsInstances = [Workspace.Terrain];
		// The ground itself, read like the server reads it: under any water.
		const ground = new RaycastParams();
		ground.FilterType = Enum.RaycastFilterType.Include;
		ground.FilterDescendantsInstances = [Workspace.Terrain];
		ground.IgnoreWater = true;
		const heights = new Map<number, number>();
		const groundAt = (x: number, z: number) => {
			const key = math.round(x) * 4096 + math.round(z);
			let height = heights.get(key);
			if (height === undefined) {
				const down = new Vector3(0, -2 * GROUND_SEARCH, 0);
				height = Workspace.Raycast(new Vector3(x, GROUND_SEARCH, z), down, ground)?.Position.Y ?? 0;
				heights.set(key, height);
			}
			return height;
		};

		// What a remove click acts on: the outlined building's -X/-Z corner cell.
		let target: [x: number, z: number] | undefined;
		// The cell under the mouse, where a drag started, and what a click or drag would place now.
		let hover: [x: number, z: number] | undefined;
		let anchor: [x: number, z: number] | undefined;
		let line = new Array<Placement>();

		const frame = RunService.RenderStepped.Connect(() => {
			target = undefined;
			const camera = Workspace.CurrentCamera;
			if (!camera) return;
			const mouse = UserInputService.GetMouseLocation();
			const ray = camera.ViewportPointToRay(mouse.X, mouse.Y);
			const taken = occupancy();

			if (!def || !kind) {
				const { building: model, prop, cell } = pointedAt(taken);
				const corner = model?.GetAttribute("Cell");
				if (model) {
					if (typeIs(corner, "number") && model.GetAttribute("Kind") !== "core") {
						highlight.Adornee = model;
						target = cellCoords(corner);
					}
				} else if (prop && cell !== undefined && !CollectionService.HasTag(prop, "Ore")) {
					// No building there: a tree or rock is cleared instead.
					highlight.Adornee = prop;
					target = cellCoords(cell);
				}
				highlight.Enabled = target !== undefined;
				return;
			}

			const hit = Workspace.Raycast(ray.Origin, ray.Direction.mul(RAY_LENGTH), terrain);
			// Offset by half the extra size, so a block bigger than a cell centres on the cursor.
			const half = ((size - 1) * CELL_STUDS) / 2;
			const corner = hit ? cellAt(hit.Position.X - half, hit.Position.Z - half) : undefined;
			hover = corner !== undefined ? cellCoords(corner) : undefined;
			if (!hover) line = [];
			else if (anchor && size === 1) line = lineBetween(anchor, hover, this.rotation, belt);
			else line = [{ x: hover[0], z: hover[1], rotation: this.rotation }];

			const root = this.characterController.getRig()?.HumanoidRootPart.Position;
			const pool = baseStateAtom()?.pool ?? [];
			const zones = baseStateAtom()?.dropZones ?? [];
			// What the line costs so far: each cell is paid for on top of those before it.
			const spent = new Map<ResourceId, number>();
			// A crossing the server can't lay stops the line there.
			let stopped = false;
			let color = COLORS.danger;
			const crossings = line.map(
				({ x, z, rotation }, index) =>
					belt && index > 0 && index < line.size() - 1 && crossable(modelOn(taken, x, z), rotation),
			);
			const paths = belt ? linePaths(line, crossings, taken, groundAt) : [];
			line.forEach(({ x, z, rotation }, index) => {
				const cell = cellIndex(x, z);
				const centre = cellCenter(cell, size);
				const crossing = crossings[index];
				for (const { resource, amount } of (crossing ? BUILDINGS.junction : def).cost) {
					spent.set(resource, (spent.get(resource) ?? 0) + amount);
				}
				// Like the server: a belt line keeps the routers and such it runs through, anything else swaps them.
				const there = modelOn(taken, x, z)?.GetAttribute("Kind") as BuildingKind | undefined;
				const swapping = there !== undefined && replaces(kind, there, belt && line.size() > 1);
				let free = !crossing;
				let onOre = false;
				for (let dz = 0; dz < size; dz++) {
					for (let dx = 0; dx < size; dx++) {
						free &&= swapping || modelOn(taken, x + dx, z + dz) === undefined;
						onOre ||= ores.has(cellIndex(x + dx, z + dz));
					}
				}
				let affordable = true;
				for (const [resource, amount] of spent) affordable &&= amountOf(pool, resource) >= amount;
				// For the colour only: the server decides.
				const valid =
					!stopped &&
					x + size <= GRID_SIZE &&
					z + size <= GRID_SIZE &&
					(crossing ? canBuild(levelsAtom(), "junction") : free) &&
					(!def.drill || onOre) &&
					!inDropZone(cell, size, zones) &&
					affordable &&
					root !== undefined &&
					// Across the ground, like the server's check.
					new Vector2(root.X - centre.X, root.Z - centre.Z).Magnitude <= BUILD_RANGE;
				stopped ||= crossing && !valid;
				color = valid ? COLORS.confirm : COLORS.danger;

				const shaped = paths[index];
				if (shaped) {
					// As it will be built: following the ground within its grade, curving where the line
					// turns or out of what feeds it, and reaching into a belt it runs into from the side.
					const [path, tail] = shaped;
					const runs = beltRuns(path, 0, tail);
					const parts = partsFor(index, runs.size() + 2);
					runs.forEach(([run, length], i) => {
						parts[i].Size = new Vector3(BELT_WIDTH, 0.4, length + 0.05);
						parts[i].CFrame = run.mul(new CFrame(0, -0.2, 0));
						parts[i].Color = color;
						parts[i].Transparency = GHOST_TRANSPARENCY;
					});
					// The chevron stays white, so it reads against the runs.
					chevronBars(chevronRun(path)).forEach((bar, i) => {
						const part = parts[runs.size() + i];
						part.Size = CHEVRON;
						part.CFrame = bar;
						part.Color = COLORS.text;
						part.Transparency = 0.1;
					});
				} else {
					const [part] = partsFor(index, 1);
					const width = size * CELL_STUDS - 0.4;
					const base = new CFrame(centre.X, groundAt(centre.X, centre.Z) + CELL_STUDS / 2, centre.Z);
					part.Size = new Vector3(width, CELL_STUDS, width);
					part.CFrame = base.mul(CFrame.Angles(0, (rotation * math.pi) / 2, 0));
					part.Color = color;
					part.Transparency = GHOST_TRANSPARENCY;
				}
			});
			for (let index = line.size(); index < ghosts.size(); index++) partsFor(index, 0);

			if (ring && hover) {
				const centre = cellCenter(cellIndex(hover[0], hover[1]), size);
				// A cylinder's axis is X, so tip it onto its side to lie flat.
				ring.CFrame = new CFrame(centre.X, groundAt(centre.X, centre.Z), centre.Z).mul(
					CFrame.Angles(0, 0, math.pi / 2),
				);
				ring.Color = color;
				ring.Transparency = RING_TRANSPARENCY;
			} else if (ring) {
				ring.Transparency = 1;
			}
		});

		// A building places on release, so a press can start a drag instead.
		const press = UserInputService.InputBegan.Connect((input, processed) => {
			if (processed || input.UserInputType !== Enum.UserInputType.MouseButton1) return;
			if (kind) anchor = hover;
			else if (target) baseMessaging.server.emit(BaseMessage.Remove, { x: target[0], z: target[1] });
		});
		const release = UserInputService.InputEnded.Connect((input) => {
			if (input.UserInputType !== Enum.UserInputType.MouseButton1 || !kind || !anchor) return;
			anchor = undefined;
			if (!line.isEmpty()) baseMessaging.server.emit(BaseMessage.Place, { kind, cells: line });
		});

		return () => {
			frame.Disconnect();
			press.Disconnect();
			release.Disconnect();
			folder.Destroy();
		};
	}
}
