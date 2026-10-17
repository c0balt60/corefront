import { block, weld } from "game/Base/server/models";
import { BLASTERS, type BlasterKind } from "game/Base/shared/blasters";

const LIGHT = Color3.fromRGB(152, 154, 164);
const MID = Color3.fromRGB(110, 112, 128);
const DARK = Color3.fromRGB(74, 75, 83);

/** A part's colour: the gun's greys, or its Blaster's `color`, plain (`trim`) or glowing (`glow`). */
type Shade = "light" | "mid" | "dark" | "trim" | "glow";

/** One part of a gun: its size, where it sits on the handle, and its shade. */
type Piece = readonly [size: Vector3, at: CFrame, shade: Shade];

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
const at = (x: number, y: number, z: number) => new CFrame(x, y, z);

/** Every gun's grip and stock, under and behind the handle. */
const STOCK: ReadonlyArray<Piece> = [
	[v(0.3, 0.35, 0.4), at(0, 0, 0.9), "dark"],
	[v(0.28, 0.7, 0.3), at(0, -0.55, 0.4).mul(CFrame.Angles(math.rad(-12), 0, 0)), "dark"],
];

/** Each Blaster's own parts, its barrel down -Z, and where its muzzle is. */
const GUNS: Record<BlasterKind, { readonly pieces: ReadonlyArray<Piece>; readonly muzzle: Vector3 }> = {
	// A pistol: a top rail, a magazine, one barrel.
	blaster: {
		pieces: [
			[v(0.3, 0.15, 1), at(0, 0.32, -0.1), "light"],
			[v(0.42, 0.1, 0.25), at(0, 0.05, -0.3), "trim"],
			[v(0.32, 0.32, 0.5), at(0, 0.05, -0.95), "light"],
			[v(0.18, 0.18, 0.5), at(0, 0.05, -1.4), "dark"],
			[v(0.28, 0.28, 0.2), at(0, 0.05, -1.65), "mid"],
			[v(0.12, 0.12, 0.08), at(0, 0.05, -1.78), "glow"],
			[v(0.3, 0.45, 0.4), at(0, -0.45, -0.25), "light"],
			[v(0.32, 0.25, 0.1), at(0, -0.45, -0.25), "glow"],
		],
		muzzle: v(0, 0.05, -1.85),
	},
	// Stubby and pale, a glowing ring round its short barrel and a cross on each side.
	mender: {
		pieces: [
			[v(0.42, 0.55, 1.1), at(0, 0.05, -0.2), "light"],
			[v(0.3, 0.3, 0.5), at(0, 0.05, -0.95), "light"],
			[v(0.5, 0.08, 0.1), at(0, 0.3, -1.05), "glow"],
			[v(0.5, 0.08, 0.1), at(0, -0.2, -1.05), "glow"],
			[v(0.08, 0.5, 0.1), at(0.21, 0.05, -1.05), "glow"],
			[v(0.08, 0.5, 0.1), at(-0.21, 0.05, -1.05), "glow"],
			[v(0.2, 0.2, 0.06), at(0, 0.05, -1.22), "glow"],
			[v(0.05, 0.3, 0.1), at(0.235, 0.05, -0.2), "glow"],
			[v(0.05, 0.1, 0.3), at(0.235, 0.05, -0.2), "glow"],
			[v(0.05, 0.3, 0.1), at(-0.235, 0.05, -0.2), "glow"],
			[v(0.05, 0.1, 0.3), at(-0.235, 0.05, -0.2), "glow"],
		],
		muzzle: v(0, 0.05, -1.27),
	},
	// Two barrels side by side on a wide body.
	twin: {
		pieces: [
			[v(0.55, 0.2, 1.1), at(0, 0.3, -0.2), "mid"],
			[v(0.55, 0.12, 0.25), at(0, 0.1, -0.5), "trim"],
			[v(0.2, 0.2, 1.1), at(0.15, 0.05, -1.1), "dark"],
			[v(0.2, 0.2, 1.1), at(-0.15, 0.05, -1.1), "dark"],
			[v(0.24, 0.24, 0.15), at(0.15, 0.05, -1.6), "light"],
			[v(0.24, 0.24, 0.15), at(-0.15, 0.05, -1.6), "light"],
			[v(0.12, 0.12, 0.06), at(0.15, 0.05, -1.69), "glow"],
			[v(0.12, 0.12, 0.06), at(-0.15, 0.05, -1.69), "glow"],
			[v(0.3, 0.5, 0.35), at(0, -0.45, -0.3), "light"],
		],
		muzzle: v(0, 0.05, -1.72),
	},
	// A fuel tank slung under a short pipe with a wide nozzle and a pilot light.
	flamer: {
		pieces: [
			[v(0.36, 0.36, 1), at(0, -0.3, -0.55), "trim"],
			[v(0.4, 0.08, 0.08), at(0, -0.3, -0.2), "dark"],
			[v(0.4, 0.08, 0.08), at(0, -0.3, -0.85), "dark"],
			[v(0.2, 0.2, 0.8), at(0, 0.15, -1), "dark"],
			[v(0.42, 0.42, 0.3), at(0, 0.15, -1.45), "mid"],
			[v(0.32, 0.32, 0.06), at(0, 0.15, -1.62), "glow"],
			[v(0.08, 0.08, 0.08), at(0, -0.08, -1.45), "glow"],
		],
		muzzle: v(0, 0.15, -1.68),
	},
	// A long pair of rails, glowing coils down its length.
	rail: {
		pieces: [
			[v(0.3, 0.2, 1.2), at(0, 0.32, -0.2), "dark"],
			[v(0.08, 0.14, 1.9), at(0.13, 0.05, -1.4), "light"],
			[v(0.08, 0.14, 1.9), at(-0.13, 0.05, -1.4), "light"],
			[v(0.4, 0.4, 0.08), at(0, 0.05, -0.75), "glow"],
			[v(0.38, 0.38, 0.08), at(0, 0.05, -1.25), "glow"],
			[v(0.36, 0.36, 0.08), at(0, 0.05, -1.75), "glow"],
			[v(0.1, 0.1, 1.6), at(0, 0.05, -1.3), "trim"],
			[v(0.3, 0.45, 0.4), at(0, -0.45, -0.25), "mid"],
		],
		muzzle: v(0, 0.05, -2.4),
	},
	// A glowing coil between two prongs that splay apart, each tipped with a spark.
	arc: {
		pieces: [
			[v(0.3, 0.3, 0.7), at(0, 0.05, -0.9), "dark"],
			[v(0.36, 0.36, 0.1), at(0, 0.05, -0.7), "glow"],
			[v(0.36, 0.36, 0.1), at(0, 0.05, -0.95), "glow"],
			[v(0.36, 0.36, 0.1), at(0, 0.05, -1.2), "glow"],
			[v(0.08, 0.08, 0.7), at(0.2, 0.05, -1.5).mul(CFrame.Angles(0, math.rad(-12), 0)), "light"],
			[v(0.08, 0.08, 0.7), at(-0.2, 0.05, -1.5).mul(CFrame.Angles(0, math.rad(12), 0)), "light"],
			[v(0.15, 0.15, 0.15), at(0.27, 0.05, -1.85), "glow"],
			[v(0.15, 0.15, 0.15), at(-0.27, 0.05, -1.85), "glow"],
		],
		muzzle: v(0, 0.05, -1.85),
	},
	// A fat tube tipped up, banded near its mouth.
	mortar: {
		pieces: [
			[v(0.55, 0.55, 1.3), at(0, 0.2, -0.7).mul(CFrame.Angles(math.rad(15), 0, 0)), "dark"],
			[v(0.62, 0.62, 0.12), at(0, 0.33, -1.25).mul(CFrame.Angles(math.rad(15), 0, 0)), "mid"],
			[v(0.6, 0.6, 0.08), at(0, 0.27, -1.05).mul(CFrame.Angles(math.rad(15), 0, 0)), "glow"],
			[v(0.5, 0.15, 0.5), at(0, -0.15, -0.3), "trim"],
		],
		muzzle: v(0, 0.4, -1.4),
	},
};

/** The Blaster `kind` as a Tool, named after it, its kind its `Blaster` attribute (see `isBlaster`), held by its grip. */
export function blasterTool(kind: BlasterKind): Tool {
	const def = BLASTERS[kind];
	const tool = new Instance("Tool");
	tool.Name = def.name;
	tool.CanBeDropped = false;
	tool.ToolTip = def.description;
	tool.SetAttribute("Blaster", kind);
	tool.Grip = new CFrame(0, -0.55, 0.3);
	const handle = new Instance("Part");
	handle.Name = "Handle";
	handle.Size = new Vector3(0.4, 0.5, 1.4);
	handle.Color = MID;
	handle.Material = Enum.Material.Metal;
	handle.CanCollide = false;
	handle.Parent = tool;
	const shades: Record<Shade, [Color3, Enum.Material]> = {
		light: [LIGHT, Enum.Material.Metal],
		mid: [MID, Enum.Material.Metal],
		dark: [DARK, Enum.Material.Metal],
		trim: [def.color, Enum.Material.SmoothPlastic],
		glow: [def.color, Enum.Material.Neon],
	};
	for (const [size, cframe, shade] of [...STOCK, ...GUNS[kind].pieces]) {
		const [color, material] = shades[shade];
		weld(handle, block(tool, size, cframe, color, material));
	}
	const muzzle = new Instance("Attachment");
	muzzle.Name = "Muzzle";
	muzzle.Position = GUNS[kind].muzzle;
	muzzle.Parent = handle;
	return tool;
}
