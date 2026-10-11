import { Debris, Workspace } from "@rbxts/services";

import type { AlienKind } from "game/Base/server/WaveService";
import {
	BELT_WIDTH,
	type BeltPath,
	beltRuns,
	chevronBars,
	chevronRun,
	DIRECTIONS,
	isCorner,
	pointOn,
} from "game/Base/shared/belts";
import { BUILDINGS, type BuildingKind } from "game/Base/shared/buildings";
import { type ResourceId, RESOURCES } from "game/Base/shared/resources";
import { CELL_STUDS } from "game/Terrain/shared/map";

/*
 * Placeholder art: every building and alien is a handful of parts, built here
 * so the services only deal in gameplay. Swap these for real models later.
 */

const FOUNDATION = Color3.fromRGB(70, 72, 80);
const METAL = Color3.fromRGB(122, 128, 142);
const DARK = Color3.fromRGB(46, 48, 56);
/** The team's accent, on every building. */
const GLOW = Color3.fromRGB(255, 170, 60);
const TITANIUM = Color3.fromRGB(140, 195, 225);
const REPAIR = Color3.fromRGB(110, 230, 120);
const FURNACE = Color3.fromRGB(255, 110, 40);
/** A sorter's light with no ore picked. */
const UNSORTED = Color3.fromRGB(235, 235, 240);

/** How thick a wall's post is, and how tall it stands above its footprint: thinner than a cell. */
const WALL_WIDTH = 6;
const WALL_HEIGHT = 6;

/** Each turret's barrels, welded to its head: their size, their centres on it, and their tilt up, in degrees. */
const BARRELS: Partial<Record<BuildingKind, readonly [size: Vector3, centres: ReadonlyArray<Vector3>, pitch: number]>> =
	{
		turret: [new Vector3(0.8, 0.8, 4), [new Vector3(0, 0, -3)], 0],
		autoTurret: [new Vector3(0.5, 0.5, 4.4), [new Vector3(-0.55, 0, -3.2), new Vector3(0.55, 0, -3.2)], 0],
		cannon: [new Vector3(1.8, 1.8, 9), [new Vector3(0, 0, -6.5)], 0],
		// A pod of rocket tubes on its face.
		swarmer: [
			new Vector3(1.2, 1.2, 1),
			[
				new Vector3(-1.3, 0.8, -3.1),
				new Vector3(1.3, 0.8, -3.1),
				new Vector3(-1.3, -0.8, -3.1),
				new Vector3(1.3, -0.8, -3.1),
			],
			0,
		],
		ripple: [new Vector3(1.4, 1.4, 9), [-3, -1, 1, 3].map((x) => new Vector3(x, 0, -6)), 25],
	};

const ALIEN_BODIES: Record<AlienKind, readonly [size: Vector3, color: Color3, glow: Color3]> = {
	crawler: [new Vector3(2.6, 1.2, 3.2), Color3.fromRGB(58, 34, 72), Color3.fromRGB(190, 255, 90)],
	brute: [new Vector3(5, 4, 6), Color3.fromRGB(72, 30, 30), Color3.fromRGB(255, 90, 40)],
	spitter: [new Vector3(2.4, 3, 2.4), Color3.fromRGB(30, 60, 58), Color3.fromRGB(80, 255, 160)],
};

/** An anchored part: the brick everything here is made of. */
export function block(
	parent: Instance,
	size: Vector3,
	cframe: CFrame,
	color: Color3,
	material: Enum.Material = Enum.Material.SmoothPlastic,
): Part {
	const part = new Instance("Part");
	part.Anchored = true;
	part.Size = size;
	part.CFrame = cframe;
	part.Color = color;
	part.Material = material;
	part.TopSurface = Enum.SurfaceType.Smooth;
	part.BottomSurface = Enum.SurfaceType.Smooth;
	part.Parent = parent;
	return part;
}

/** Welds `part` to `root`, so it rides along whenever the server moves the root. */
export function weld<T extends BasePart>(root: BasePart, part: T): T {
	part.Anchored = false;
	part.Massless = true;
	part.CanCollide = false;
	const constraint = new Instance("WeldConstraint");
	constraint.Part0 = root;
	constraint.Part1 = part;
	constraint.Parent = part;
	return part;
}

/** Gives the Build tool its Handle: a stubby emitter with the team's glow at the tip. */
export function buildToolHandle(tool: Tool) {
	const handle = new Instance("Part");
	handle.Name = "Handle";
	handle.Size = new Vector3(0.4, 0.6, 1.4);
	handle.Color = DARK;
	handle.Material = Enum.Material.Metal;
	handle.CanCollide = false;
	handle.Parent = tool;
	weld(handle, block(tool, new Vector3(0.8, 0.8, 0.5), new CFrame(0, 0.1, -0.85), METAL, Enum.Material.Metal));
	weld(handle, block(tool, new Vector3(0.5, 0.5, 0.15), new CFrame(0, 0.1, -1.15), GLOW, Enum.Material.Neon));
}

/** Writes `Health` and `MaxHealth`, and shows a small bar over the model once it is damaged. */
export function setHealth(model: Model, health: number, maxHealth: number) {
	model.SetAttribute("Health", health);
	model.SetAttribute("MaxHealth", maxHealth);
	const root = model.PrimaryPart;
	if (health >= maxHealth || !root) return;

	let bar = model.FindFirstChild("HealthBar") as BillboardGui | undefined;
	if (!bar) {
		bar = new Instance("BillboardGui");
		bar.Name = "HealthBar";
		bar.Adornee = root;
		bar.Size = UDim2.fromOffset(44, 6);
		bar.StudsOffsetWorldSpace = new Vector3(0, root.Size.Y / 2 + 3, 0);
		bar.MaxDistance = 160;
		const back = new Instance("Frame");
		back.Size = UDim2.fromScale(1, 1);
		back.BackgroundColor3 = Color3.fromRGB(20, 20, 24);
		back.BorderSizePixel = 0;
		back.Parent = bar;
		const fill = new Instance("Frame");
		fill.Name = "Fill";
		fill.BorderSizePixel = 0;
		fill.ZIndex = 2;
		fill.Parent = bar;
		bar.Parent = model;
	}

	const fraction = math.clamp(health / maxHealth, 0, 1);
	const fill = bar.FindFirstChild("Fill") as Frame;
	fill.Size = UDim2.fromScale(fraction, 1);
	fill.BackgroundColor3 = Color3.fromRGB(255, 80, 80).Lerp(Color3.fromRGB(110, 230, 120), fraction);
}

/** Writes a turret's `Ammo` (items loaded), and shows NO AMMO over it while that's none. */
export function setAmmo(model: Model, items: number) {
	model.SetAttribute("Ammo", items);
	const root = model.PrimaryPart;
	if (!root) return;

	let sign = model.FindFirstChild("NoAmmo") as BillboardGui | undefined;
	if (!sign) {
		sign = new Instance("BillboardGui");
		sign.Name = "NoAmmo";
		sign.Adornee = root;
		sign.Size = UDim2.fromOffset(90, 18);
		sign.StudsOffsetWorldSpace = new Vector3(0, root.Size.Y / 2 + 5, 0);
		sign.MaxDistance = 160;
		const text = new Instance("TextLabel");
		text.BackgroundTransparency = 1;
		text.Size = UDim2.fromScale(1, 1);
		text.Font = Enum.Font.GothamBold;
		text.Text = "NO AMMO";
		text.TextColor3 = Color3.fromRGB(255, 80, 80);
		text.TextSize = 14;
		text.TextStrokeTransparency = 0.4;
		text.Parent = sign;
		sign.Parent = model;
	}
	sign.Enabled = items === 0;
}

/** Writes a sorter's `Filter`, and lights it in that ore's colour (white for none). */
export function setFilter(model: Model, resource: ResourceId | undefined) {
	model.SetAttribute("Filter", resource);
	const light = model.FindFirstChild("Light");
	if (light?.IsA("BasePart")) light.Color = resource !== undefined ? RESOURCES[resource].color : UNSORTED;
}

/** A neon flash from `from` to `to`, `width` studs thick, seen by everyone. Shots are hitscan; this is only the look. */
export function tracer(from: Vector3, to: Vector3, color: Color3, width = 0.18) {
	const length = to.sub(from).Magnitude;
	if (length < 0.1) return;
	const cframe = CFrame.lookAt(from, to).mul(new CFrame(0, 0, -length / 2));
	const part = block(Workspace, new Vector3(width, width, length), cframe, color, Enum.Material.Neon);
	part.CanCollide = false;
	part.CanQuery = false;
	part.CanTouch = false;
	part.CastShadow = false;
	Debris.AddItem(part, 0.08);
}

/** How a belt meets what's around it, beyond its own path. */
export interface BeltLook {
	/** Its left and right rails: missing on a side something feeds it from. */
	readonly rails: readonly [left: boolean, right: boolean];
	/** Nothing feeds its back, so it's closed off there. */
	readonly capped: boolean;
	/** It feeds another belt from the side, so it reaches on into that one (see `beltRuns`). */
	readonly tail: boolean;
}

/** How deep a belt's frame is, under its surface. */
const BELT_FRAME = 0.8;
/** Where a belt's legs stand: a pair this far along it, one under each edge. */
const LEGS = [0.25, 0.75];

/**
 * A belt's parts, in `model`, along `path` (see `runPaths`): short straight pieces following its
 * curve, each tilted with it on a frame, standing on four legs down to the ground (`groundAt`)
 * wherever it's raised. Rails line it but where `look` opens them, and a chevron near its front
 * shows which way it carries. Returns its first piece, the PrimaryPart.
 */
export function beltModel(
	model: Model,
	kind: BuildingKind,
	path: BeltPath,
	groundAt: (x: number, z: number) => number,
	look: BeltLook,
): BasePart {
	model.Name = BUILDINGS[kind].name;
	const rail = kind === "titaniumConveyor" ? TITANIUM : METAL;
	// Pieces overlap so no seam shows (a curve's chords more, to close their outer edges), and
	// every other one sits a hair higher so they never flicker where they overlap.
	const seam = isCorner(path) ? 0.7 : 0.1;
	const raised = (run: CFrame, index: number) => run.mul(new CFrame(0, (index % 2) * 0.02, 0));
	const runs = beltRuns(path, 0, look.tail);
	const pieces = runs.map(([run, length], index) => {
		const frame = raised(run, index);
		const under = frame.mul(new CFrame(0, -0.3 - BELT_FRAME / 2, 0));
		block(
			model,
			new Vector3(BELT_WIDTH + 1, BELT_FRAME, length + seam + 0.2),
			under,
			FOUNDATION,
			Enum.Material.Metal,
		);
		const surface = frame.mul(new CFrame(0, -0.15, 0));
		return block(model, new Vector3(BELT_WIDTH, 0.3, length + seam), surface, DARK, Enum.Material.Fabric);
	});
	for (const t of LEGS) {
		for (const side of [-1, 1]) {
			const point = pointOn(path, t, (side * BELT_WIDTH) / 2);
			// From inside the frame to a little into the ground; none where the frame is down on it.
			const top = point.Y - 0.3 - BELT_FRAME / 2;
			const ground = groundAt(point.X, point.Z);
			if (top - ground < 0.2) continue;
			const bottom = ground - 1;
			const leg = new CFrame(point.X, (top + bottom) / 2, point.Z);
			block(model, new Vector3(0.7, top - bottom, 0.7), leg, METAL, Enum.Material.Metal);
		}
	}
	look.rails.forEach((present, index) => {
		if (!present) return;
		const offset = ((index === 0 ? -1 : 1) * (BELT_WIDTH + 0.5)) / 2;
		beltRuns(path, offset, look.tail).forEach(([run, length], piece) => {
			block(model, new Vector3(0.5, 0.7, length + 0.1), raised(run, piece), rail, Enum.Material.Metal);
		});
	});
	if (look.capped) {
		const [run, length] = runs[0];
		const back = run.mul(new CFrame(0, 0, length / 2 + 0.25));
		block(model, new Vector3(BELT_WIDTH + 1, 0.7, 0.5), back, rail, Enum.Material.Metal);
	}
	for (const bar of chevronBars(chevronRun(path))) {
		block(model, new Vector3(0.35, 0.1, 1), bar.mul(new CFrame(0, 0.03, 0)), GLOW, Enum.Material.Neon).CanCollide =
			false;
	}
	model.PrimaryPart = pieces[0];
	return pieces[0];
}

/**
 * A building's parts, in `model`: a foundation from `bottom` up to the top of the
 * footprint's highest corner, so it never floats on a slope, and a body on top turned by
 * `rotation` quarter turns. `top` is the centre of the footprint at that height.
 * The body is the PrimaryPart; a turret also returns its turning `Head`, and its barrels' tips,
 * looking out of them, relative to the head. A wall stands on no foundation: it reaches down
 * itself, and out to the walls beside it (`joined`, by side).
 */
export function buildingModel(
	model: Model,
	kind: BuildingKind,
	top: Vector3,
	bottom: number,
	rotation: number,
	oreColor?: Color3,
	joined: ReadonlyArray<boolean> = [],
): [body: BasePart, head: BasePart | undefined, muzzles: Array<CFrame>] {
	const def = BUILDINGS[kind];
	model.Name = def.name;
	const width = def.size * CELL_STUDS - 0.4;
	// Named, so the travel cutscene can fly the core off it.
	if (!def.wall) {
		block(
			model,
			new Vector3(width, top.Y - bottom, width),
			new CFrame(top.X, (top.Y + bottom) / 2, top.Z),
			FOUNDATION,
			Enum.Material.Concrete,
		).Name = "Foundation";
	}

	const base = new CFrame(top).mul(CFrame.Angles(0, (rotation * math.pi) / 2, 0));
	const at = (y: number) => base.mul(new CFrame(0, y, 0));
	let body: Part;
	let head: Part | undefined;
	const muzzles = new Array<CFrame>();
	if (kind === "core") {
		body = block(model, new Vector3(12, 8, 12), at(4), METAL, Enum.Material.DiamondPlate);
		block(model, new Vector3(13, 1, 13), at(1), GLOW, Enum.Material.Neon);
		block(model, new Vector3(4, 3, 4), at(9.5), GLOW, Enum.Material.Neon);
	} else if (kind === "drill" || kind === "advancedDrill") {
		body = block(model, new Vector3(6, 3, 6), at(1.5), METAL, Enum.Material.DiamondPlate);
		block(model, new Vector3(2, 3, 2), at(4.5), oreColor ?? GLOW, Enum.Material.Neon);
		if (kind === "advancedDrill") {
			block(model, new Vector3(4, 1, 4), at(3.5), DARK, Enum.Material.Metal);
			block(model, new Vector3(1, 2, 1), at(7), GLOW, Enum.Material.Neon);
		}
	} else if (kind === "laserDrill") {
		body = block(model, new Vector3(13, 3, 13), at(1.5), METAL, Enum.Material.DiamondPlate);
		// A beam the ore's colour between four legs, under a plate and its lens.
		for (const [x, z] of [
			[-4.5, -4.5],
			[4.5, -4.5],
			[-4.5, 4.5],
			[4.5, 4.5],
		]) {
			block(model, new Vector3(2, 5, 2), at(5.5).mul(new CFrame(x, 0, z)), DARK, Enum.Material.Metal);
		}
		block(model, new Vector3(3, 5, 3), at(5.5), oreColor ?? GLOW, Enum.Material.Neon);
		block(model, new Vector3(11, 1, 11), at(8.5), DARK, Enum.Material.Metal);
		block(model, new Vector3(4, 1, 4), at(9.5), GLOW, Enum.Material.Neon);
	} else if (def.wall) {
		// A post thinner than a cell, from the foundation's depth up, with an arm out to each wall beside it.
		const color = kind === "titaniumWall" ? TITANIUM : DARK;
		const bands = kind === "titaniumWall" ? [1.5, 4.5] : [4.5];
		const height = top.Y + WALL_HEIGHT - bottom;
		const middle = new Vector3(top.X, (top.Y + WALL_HEIGHT + bottom) / 2, top.Z);
		body = block(
			model,
			new Vector3(WALL_WIDTH, height, WALL_WIDTH),
			new CFrame(middle),
			color,
			Enum.Material.Metal,
		);
		for (const y of bands) {
			const band = new Vector3(WALL_WIDTH + 0.1, 0.4, WALL_WIDTH + 0.1);
			block(model, band, new CFrame(top.add(new Vector3(0, y, 0))), GLOW, Enum.Material.Neon);
		}
		const arm = (CELL_STUDS - WALL_WIDTH) / 2;
		DIRECTIONS.forEach(([dx, dz], side) => {
			if (!joined[side]) return;
			const toward = new Vector3(dx, 0, dz);
			const shape = (length: number, tall: number, thick: number) =>
				dx !== 0 ? new Vector3(length, tall, thick) : new Vector3(thick, tall, length);
			// From the post's side to the cell's edge, where the next wall's arm meets it.
			const out = new CFrame(middle.add(toward.mul((WALL_WIDTH + CELL_STUDS) / 4)));
			block(model, shape(arm, height, WALL_WIDTH), out, color, Enum.Material.Metal);
			for (const y of bands) {
				// Clear of the post's band, so their faces never overlap.
				const spot = top.add(toward.mul((WALL_WIDTH + 0.1 + CELL_STUDS) / 4)).add(new Vector3(0, y, 0));
				block(model, shape(arm - 0.05, 0.4, WALL_WIDTH + 0.1), new CFrame(spot), GLOW, Enum.Material.Neon);
			}
		});
	} else if (kind === "mender") {
		body = block(model, new Vector3(5, 2, 5), at(1), DARK, Enum.Material.Metal);
		const orb = block(model, new Vector3(3, 3, 3), at(3.5), REPAIR, Enum.Material.Neon);
		orb.Shape = Enum.PartType.Ball;
	} else if (kind === "router") {
		body = block(model, new Vector3(5, 2.5, 5), at(1.25), METAL, Enum.Material.DiamondPlate);
		block(model, new Vector3(5.3, 0.5, 5.3), at(1.6), GLOW, Enum.Material.Neon);
		block(model, new Vector3(2.4, 0.8, 2.4), at(2.9), DARK, Enum.Material.Metal);
	} else if (kind === "sorter") {
		body = block(model, new Vector3(5, 2.5, 5), at(1.25), DARK, Enum.Material.Metal);
		// Lit in the colour of the ore it lets through (see `setFilter`).
		block(model, new Vector3(3, 0.8, 3), at(2.9), UNSORTED, Enum.Material.Neon).Name = "Light";
	} else if (kind === "junction") {
		body = block(model, new Vector3(6, 1.5, 6), at(0.75), METAL, Enum.Material.DiamondPlate);
		block(model, new Vector3(6.2, 0.4, 1.4), at(1.6), GLOW, Enum.Material.Neon);
		block(model, new Vector3(1.4, 0.4, 6.2), at(1.6), GLOW, Enum.Material.Neon);
	} else if (kind === "graphitePress") {
		body = block(model, new Vector3(13, 6, 13), at(3), DARK, Enum.Material.Metal);
		block(model, new Vector3(13.2, 0.5, 13.2), at(5.2), GLOW, Enum.Material.Neon);
		// The furnace's mouth on its front, and a chimney at the back.
		block(model, new Vector3(6, 2.4, 0.4), at(2).mul(new CFrame(0, 0, -6.6)), FURNACE, Enum.Material.Neon);
		block(model, new Vector3(2.4, 5, 2.4), at(8.5).mul(new CFrame(4, 0, 4)), METAL, Enum.Material.Metal);
	} else if (kind === "siliconSmelter") {
		body = block(model, new Vector3(13, 5, 13), at(2.5), METAL, Enum.Material.DiamondPlate);
		block(model, new Vector3(13.2, 0.5, 13.2), at(4.2), GLOW, Enum.Material.Neon);
		// A crucible glowing on top, between two chimneys at the back.
		block(model, new Vector3(5, 1, 5), at(5.5), FURNACE, Enum.Material.Neon);
		for (const x of [-4.5, 4.5]) {
			block(model, new Vector3(2, 6, 2), at(8).mul(new CFrame(x, 0, 4)), DARK, Enum.Material.Metal);
		}
	} else {
		// Turrets: a body, and a head that turns to aim with its barrels welded on. Bigger ones scale up.
		const scale = def.size;
		body = block(model, new Vector3(6, 2, 6).mul(scale), at(scale), DARK, Enum.Material.Metal);
		head = block(model, new Vector3(3, 2, 3).mul(scale), at(3 * scale), METAL, Enum.Material.DiamondPlate);
		head.Name = "Head";
		const [barrel, centres, pitch] = BARRELS[kind]!;
		for (const centre of centres) {
			const offset = new CFrame(centre).mul(CFrame.Angles(math.rad(pitch), 0, 0));
			weld(head, block(model, barrel, head.CFrame.mul(offset), GLOW, Enum.Material.Neon));
			muzzles.push(offset.mul(new CFrame(0, 0, -barrel.Z / 2)));
		}
	}
	model.PrimaryPart = body;
	return [body, head, muzzles];
}

/**
 * An alien: an anchored root the server moves with `BulkMoveTo`, and neon
 * accents welded to it. Nothing collides, so moving it never shoves players.
 */
export function alienModel(kind: AlienKind, cframe: CFrame): [model: Model, root: Part] {
	const model = new Instance("Model");
	model.Name = kind;
	const [size, color, glow] = ALIEN_BODIES[kind];
	const root = block(model, size, cframe, color, Enum.Material.Slate);
	root.CanCollide = false;
	root.CanTouch = false;
	const accent = (partSize: Vector3, x: number, y: number, z: number) =>
		weld(root, block(model, partSize, cframe.mul(new CFrame(x, y, z)), glow, Enum.Material.Neon));

	// Eyes on the front (-Z), which is where the root looks.
	const front = -size.Z / 2;
	if (kind === "crawler") {
		accent(new Vector3(0.4, 0.3, 0.2), -0.6, 0.2, front);
		accent(new Vector3(0.4, 0.3, 0.2), 0.6, 0.2, front);
		accent(new Vector3(0.5, 0.2, 2.2), 0, 0.65, 0.2);
	} else if (kind === "brute") {
		accent(new Vector3(0.7, 0.5, 0.2), -1.2, 0.8, front);
		accent(new Vector3(0.7, 0.5, 0.2), 1.2, 0.8, front);
		accent(new Vector3(5.2, 0.6, 1.2), 0, -1.2, front + 0.5);
		accent(new Vector3(0.6, 1.6, 0.6), -1.8, 2.6, front + 1.2);
		accent(new Vector3(0.6, 1.6, 0.6), 1.8, 2.6, front + 1.2);
	} else {
		accent(new Vector3(0.4, 0.3, 0.2), -0.5, 0.9, front);
		accent(new Vector3(0.4, 0.3, 0.2), 0.5, 0.9, front);
		accent(new Vector3(2.2, 2.2, 2.2), 0, 2.2, 0.3).Shape = Enum.PartType.Ball;
	}
	model.PrimaryPart = root;
	return [model, root];
}
