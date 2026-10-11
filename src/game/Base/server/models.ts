import { Debris, Workspace } from "@rbxts/services";

import type { AlienKind } from "game/Base/server/WaveService";
import { BUILDINGS, type BuildingKind } from "game/Base/shared/buildings";
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

/** A neon flash from `from` to `to`, seen by everyone. Shots are hitscan; this is only the look. */
export function tracer(from: Vector3, to: Vector3, color: Color3) {
	const length = to.sub(from).Magnitude;
	if (length < 0.1) return;
	const cframe = CFrame.lookAt(from, to).mul(new CFrame(0, 0, -length / 2));
	const part = block(Workspace, new Vector3(0.18, 0.18, length), cframe, color, Enum.Material.Neon);
	part.CanCollide = false;
	part.CanQuery = false;
	part.CanTouch = false;
	part.CastShadow = false;
	Debris.AddItem(part, 0.08);
}

/**
 * A building: a foundation from `bottom` up to the top of the footprint's
 * highest corner, so it never floats on a slope, and a body on top turned by
 * `rotation` quarter turns. `top` is the centre of the footprint at that height.
 * The body is the PrimaryPart; a turret also returns its turning `Head`.
 */
export function buildingModel(
	kind: BuildingKind,
	top: Vector3,
	bottom: number,
	rotation: number,
	oreColor?: Color3,
): [model: Model, head: BasePart | undefined] {
	const model = new Instance("Model");
	model.Name = BUILDINGS[kind].name;
	const width = BUILDINGS[kind].size * CELL_STUDS - 0.4;
	// Named, so the travel cutscene can fly the core off it.
	block(
		model,
		new Vector3(width, top.Y - bottom, width),
		new CFrame(top.X, (top.Y + bottom) / 2, top.Z),
		FOUNDATION,
		Enum.Material.Concrete,
	).Name = "Foundation";

	const base = new CFrame(top).mul(CFrame.Angles(0, (rotation * math.pi) / 2, 0));
	const at = (y: number) => base.mul(new CFrame(0, y, 0));
	let body: Part;
	let head: Part | undefined;
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
	} else if (kind === "wall" || kind === "titaniumWall") {
		const titanium = kind === "titaniumWall";
		body = block(model, new Vector3(width, 6, width), at(3), titanium ? TITANIUM : DARK, Enum.Material.Metal);
		block(model, new Vector3(width + 0.1, 0.4, width + 0.1), at(4.5), GLOW, Enum.Material.Neon);
		if (titanium) block(model, new Vector3(width + 0.1, 0.4, width + 0.1), at(1.5), GLOW, Enum.Material.Neon);
	} else if (kind === "mender") {
		body = block(model, new Vector3(5, 2, 5), at(1), DARK, Enum.Material.Metal);
		const orb = block(model, new Vector3(3, 3, 3), at(3.5), REPAIR, Enum.Material.Neon);
		orb.Shape = Enum.PartType.Ball;
	} else {
		// Turrets, the heavy one twice the size.
		const scale = kind === "heavyTurret" ? 2 : 1;
		body = block(model, new Vector3(6, 2, 6).mul(scale), at(scale), DARK, Enum.Material.Metal);
		head = block(model, new Vector3(3, 2, 3).mul(scale), at(3 * scale), METAL, Enum.Material.DiamondPlate);
		head.Name = "Head";
		const barrel = new Vector3(0.8, 0.8, 4).mul(scale);
		for (const side of scale > 1 ? [-1, 1] : [0]) {
			const offset = new CFrame(side * 1.2, 0, -3 * scale);
			weld(head, block(model, barrel, head.CFrame.mul(offset), GLOW, Enum.Material.Neon));
		}
	}
	model.PrimaryPart = body;
	return [model, head];
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
