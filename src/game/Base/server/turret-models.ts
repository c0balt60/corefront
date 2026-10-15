import type { BuildingKind } from "game/Base/shared/buildings";

/* Pieces of the placeholder art (see `models`), and every turret's look, kept apart so `models` stays under Luau's 200 locals. */

export const DARK = Color3.fromRGB(46, 48, 56);
export const NEON = Enum.Material.Neon;

/**
 * A part welded to an alien's hull: its size, where on the hull, its colour, and its material and
 * shape if not plain metal. A turret's barrel `recoils`: it kicks back when its muzzle fires.
 */
export type Piece = readonly [
	size: Vector3,
	at: CFrame,
	color: Color3,
	material?: Enum.Material,
	shape?: Enum.PartType,
	recoils?: boolean,
];

/** Each piece, and its mirror image on the hull's other side (-X). */
export function both(...pieces: Array<Piece>): Array<Piece> {
	const mirrored = pieces.map(([size, at, color, material, shape, recoils]): Piece => {
		const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = at.GetComponents();
		const flipped = new CFrame(-x, y, z, r00, -r01, -r02, -r10, r11, r12, -r20, r21, r22);
		return [size, flipped, color, material, shape, recoils];
	});
	return [...pieces, ...mirrored];
}

/** At (x, y, z), tipped `degrees` about the hull's length: at 90, a cylinder (which lies along X) stands as a flat rotor disc. */
export function splay(x: number, y: number, z: number, degrees: number): CFrame {
	return new CFrame(x, y, z).mul(CFrame.Angles(0, 0, math.rad(degrees)));
}

/** Turrets: dark gunmetal heads on a plate with light corner brackets, each picked out in its own colours. */
const GUNMETAL = Color3.fromRGB(64, 67, 77);
const BRACKET = Color3.fromRGB(160, 164, 176);
const CREAM = Color3.fromRGB(236, 226, 208);
const COPPER = Color3.fromRGB(200, 128, 82);
const TAN = Color3.fromRGB(176, 132, 96);
const BLUE = Color3.fromRGB(84, 118, 224);
const ICE = Color3.fromRGB(150, 190, 245);
const WHITE = Color3.fromRGB(232, 236, 244);
const EMBER = Color3.fromRGB(255, 96, 48);
const PINK = Color3.fromRGB(255, 150, 215);
const VIOLET = Color3.fromRGB(170, 80, 210);
const RED = Color3.fromRGB(230, 70, 60);
const AMBER = Color3.fromRGB(255, 170, 50);
const GOLD = Color3.fromRGB(255, 214, 80);
const ORANGE = Color3.fromRGB(255, 130, 40);
const CYAN = Color3.fromRGB(110, 225, 255);
const GREEN = Color3.fromRGB(110, 215, 90);

/** Pieces made of each of `items`, all together. */
function each<T>(items: ReadonlyArray<T>, make: (item: T) => ReadonlyArray<Piece>): Array<Piece> {
	const pieces = new Array<Piece>();
	for (const item of items) for (const piece of make(item)) pieces.push(piece);
	return pieces;
}

/** A round tube, `length` along Z (a cylinder lies along X), centred at `at`. */
function tube(length: number, diameter: number, at: CFrame, color: Color3, material?: Enum.Material): Piece {
	const along = at.mul(CFrame.Angles(0, math.pi / 2, 0));
	return [new Vector3(length, diameter, diameter), along, color, material, Enum.PartType.Cylinder];
}

/** These pieces as barrels, which kick back when they fire. */
function recoiling(...pieces: Array<Piece>): Array<Piece> {
	return pieces.map(([size, at, color, material, shape]): Piece => [size, at, color, material, shape, true]);
}

/** Every turret's base, from the top of its foundation: its plate (the body), a bracket on each corner, and its turntable. */
export const TURRET_BASE: ReadonlyArray<Piece> = [
	[new Vector3(6.4, 1, 6.4), new CFrame(0, 0.5, 0), DARK],
	...each([1, -1], (sz) =>
		both(
			[new Vector3(2.4, 1.3, 0.9), new CFrame(2.6, 0.65, sz * 2.95), BRACKET],
			[new Vector3(0.9, 1.3, 2.4), new CFrame(2.95, 0.65, sz * 2.6), BRACKET],
		),
	),
	[new Vector3(0.6, 4.6, 4.6), splay(0, 1.3, 0, 90), GUNMETAL, undefined, Enum.PartType.Cylinder],
];

/** The tilted barrels: the mortar's, and the artillery's four, each where it's raised from on the head. */
const MORTAR = new CFrame(0, 0.9, -0.6).mul(CFrame.Angles(math.rad(40), 0, 0));
const ARTILLERY = [-1.5, -0.5, 0.5, 1.5].map((x) => new CFrame(x, 0.3, -0.8).mul(CFrame.Angles(math.rad(25), 0, 0)));
/** Where across a face the gatling's six barrels are, the swarmer's six tubes and the salvo's four. */
const GATLING = [0, 1, 2, 3, 4, 5].map((i): [number, number] => [
	math.cos((i * math.pi) / 3) * 0.6,
	math.sin((i * math.pi) / 3) * 0.6,
]);
const POD: ReadonlyArray<[number, number]> = [
	[-1, 0.5],
	[-1, -0.5],
	[0, 0.5],
	[0, -0.5],
	[1, 0.5],
	[1, -0.5],
];
const QUAD: ReadonlyArray<[number, number]> = [
	[-0.55, 0.55],
	[-0.55, -0.55],
	[0.55, 0.55],
	[0.55, -0.55],
];

/**
 * Each turret's look, at a one-cell turret's scale: bigger ones scale up. Its colour, lighting the
 * ring under its turntable; how high its head turns; the head's pieces, from where it turns,
 * looking out along -Z, the first the head itself; its barrels' tips, looking out of them; and how
 * many studs its barrels (the pieces that `recoils`) kick back when they fire, if they do. The
 * railguns (Cannon, Harbinger) shoot from between twin rails held by coils, which kick back together.
 */
export const TURRET_LOOKS: Partial<
	Record<
		BuildingKind,
		// Functions, not one big table: Luau runs out of registers building it all in one go.
		() => readonly [
			accent: Color3,
			height: number,
			head: ReadonlyArray<Piece>,
			muzzles: ReadonlyArray<CFrame>,
			kick?: number,
		]
	>
> = {
	// A compact head with copper cheeks and one sleeved barrel.
	turret: () => [
		COPPER,
		2.3,
		[
			[new Vector3(3, 1.4, 3), new CFrame(), GUNMETAL],
			...both([new Vector3(0.5, 1.2, 2.4), new CFrame(1.6, 0, 0.2), COPPER]),
			[new Vector3(2, 0.3, 1.6), new CFrame(0, 0.85, 0.4), CREAM],
			[new Vector3(0.8, 0.25, 0.1), new CFrame(0, 0.3, -1.55), COPPER, NEON],
			tube(1.2, 0.85, new CFrame(0, 0, -1.9), COPPER),
			...recoiling(tube(3.4, 0.6, new CFrame(0, 0, -3), DARK), [
				new Vector3(0.9, 0.9, 0.6),
				new CFrame(0, 0, -4.5),
				GUNMETAL,
			]),
		],
		[new CFrame(0, 0, -4.8)],
		0.5,
	],
	// Twin slim barrels between two ammo boxes.
	autoTurret: () => [
		BLUE,
		2.25,
		[
			[new Vector3(3.2, 1.3, 2.6), new CFrame(), GUNMETAL],
			...both(
				[new Vector3(0.8, 1, 1.8), new CFrame(1.95, -0.1, 0.4), TAN],
				[new Vector3(0.1, 0.25, 1.6), new CFrame(2.36, 0.15, 0.4), BLUE, NEON],
				...recoiling(
					tube(3.8, 0.4, new CFrame(0.55, 0, -3.1), DARK),
					tube(0.4, 0.55, new CFrame(0.55, 0, -4.9), BLUE),
				),
			),
			[new Vector3(2.2, 0.35, 1.8), new CFrame(0, 0.8, 0.2), BLUE],
		],
		[new CFrame(0.55, 0, -5.1), new CFrame(-0.55, 0, -5.1)],
		0.35,
	],
	// A squat burner between two fuel tanks, its wide nozzle glowing.
	scorch: () => [
		EMBER,
		2.3,
		[
			[new Vector3(2.8, 1.4, 2.6), new CFrame(), GUNMETAL],
			...both(tube(2.2, 1, new CFrame(1.65, -0.1, 0.5), EMBER)),
			[new Vector3(1.4, 1, 1.4), new CFrame(0, 0, -1.9), DARK],
			[new Vector3(1.6, 1.2, 0.4), new CFrame(0, 0, -2.7), GUNMETAL],
			[new Vector3(1.1, 0.7, 0.1), new CFrame(0, 0, -2.92), EMBER, NEON],
			tube(2, 0.25, new CFrame(0, 0.75, -1.2), BRACKET),
			[new Vector3(1.2, 0.15, 1.2), new CFrame(0, 0.75, 0.5), EMBER, NEON],
		],
		[new CFrame(0, 0, -3)],
	],
	// A fat mortar tube raised between cream armour plates.
	hail: () => [
		TAN,
		2.1,
		[
			[new Vector3(3, 1, 3), new CFrame(), GUNMETAL],
			...both([new Vector3(0.4, 1.4, 2.6), new CFrame(1.6, 0.4, 0), CREAM]),
			...recoiling(tube(3, 1.3, MORTAR, DARK), tube(0.1, 0.9, MORTAR.mul(new CFrame(0, 0, -1.5)), CREAM, NEON)),
			tube(0.6, 1.5, MORTAR.mul(new CFrame(0, 0, 0.4)), TAN),
		],
		[MORTAR.mul(new CFrame(0, 0, -1.5))],
		0.5,
	],
	// Twin flak cannons on side pods of a white head, a radar plate on top.
	scatter: () => [
		ICE,
		2.4,
		[
			[new Vector3(3, 1.6, 2.6), new CFrame(), WHITE, Enum.Material.SmoothPlastic],
			...both(
				[new Vector3(1, 1.8, 2.8), new CFrame(1.9, 0.1, -0.2), GUNMETAL],
				[new Vector3(0.1, 1, 2), new CFrame(2.42, 0.2, -0.2), ICE, NEON],
				...recoiling(tube(3, 0.7, new CFrame(1.9, 0.3, -2.8), DARK), [
					new Vector3(0.95, 0.95, 0.5),
					new CFrame(1.9, 0.3, -4.3),
					ICE,
				]),
			),
			[new Vector3(1.6, 0.15, 1.2), new CFrame(0, 1.15, 0.6).mul(CFrame.Angles(math.rad(25), 0, 0)), ICE],
		],
		[new CFrame(1.9, 0.3, -4.55), new CFrame(-1.9, 0.3, -4.55)],
		0.4,
	],
	// A gatling: six barrels in a ring out of a blue shroud, fed from a drum.
	vulcan: () => [
		BLUE,
		2.5,
		[
			[new Vector3(2.8, 1.8, 2.6), new CFrame(), GUNMETAL],
			tube(1.6, 2, new CFrame(0, 0, -1.8), BLUE),
			...recoiling(...GATLING.map(([x, y]) => tube(3.6, 0.35, new CFrame(x, y, -3.6), DARK))),
			tube(0.3, 1.7, new CFrame(0, 0, -5.2), BRACKET),
			[new Vector3(1.2, 1.6, 1.6), new CFrame(1.9, -0.1, 0.3), BLUE, undefined, Enum.PartType.Cylinder],
			[new Vector3(0.5, 0.15, 2.2), new CFrame(0, 0.95, 0.1), WHITE, NEON],
		],
		GATLING.map(([x, y]) => new CFrame(x, y, -5.4)),
		0.2,
	],
	// A claw of three prongs, edged in pink, round a glowing charge.
	fuse: () => [
		PINK,
		2.3,
		[
			[new Vector3(3.4, 1.4, 2.4), new CFrame(), GUNMETAL],
			...both([new Vector3(0.6, 1.4, 2), new CFrame(1.95, 0.1, 0.4), VIOLET]),
			...each([-1, 0, 1], (side): Array<Piece> => {
				const prong = new CFrame(side * 1.2, 0, -2.6).mul(CFrame.Angles(0, math.rad(-side * 10), 0));
				return recoiling(
					[new Vector3(0.5, 1, 3.4), prong, DARK],
					[new Vector3(0.55, 0.15, 2.6), prong.mul(new CFrame(0, 0.55, 0)), PINK, NEON],
				);
			}),
			[new Vector3(1, 1, 1), new CFrame(0, 0.2, -1.1), PINK, NEON, Enum.PartType.Ball],
		],
		[new CFrame(-1.2, 0, -4.3), new CFrame(0, 0, -4.3), new CFrame(1.2, 0, -4.3)],
		0.4,
	],
	// A white launcher with red chevrons and four barrels in a square.
	salvo: () => [
		RED,
		2.6,
		[
			[new Vector3(3, 2, 2.8), new CFrame(), WHITE, Enum.Material.SmoothPlastic],
			...both(
				[new Vector3(0.4, 2.2, 3), new CFrame(1.7, 0, 0), GUNMETAL],
				[
					new Vector3(0.12, 0.3, 1.2),
					new CFrame(1.92, 0.4, 0.3).mul(CFrame.Angles(math.rad(30), 0, 0)),
					RED,
					NEON,
				],
				[
					new Vector3(0.12, 0.3, 1.2),
					new CFrame(1.92, -0.4, 0.3).mul(CFrame.Angles(math.rad(-30), 0, 0)),
					RED,
					NEON,
				],
			),
			[new Vector3(2.2, 2, 1.2), new CFrame(0, 0, -1.9), GUNMETAL],
			...each(QUAD, ([x, y]) =>
				recoiling(tube(3, 0.55, new CFrame(x, y, -3.6), DARK), tube(0.4, 0.75, new CFrame(x, y, -5), RED)),
			),
		],
		QUAD.map(([x, y]) => new CFrame(x, y, -5.2)),
		0.35,
	],
	// A railgun: twin rails, lit inside, held by white coils, its capacitors behind.
	cannon: () => [
		ICE,
		2.4,
		[
			[new Vector3(3.2, 1.6, 3.4), new CFrame(), GUNMETAL],
			[new Vector3(2.6, 1.2, 1.4), new CFrame(0, 0.4, 1.6), DARK],
			...both(
				[new Vector3(0.1, 0.8, 1.2), new CFrame(1.32, 0.4, 1.6), ICE, NEON],
				...recoiling(
					[new Vector3(0.45, 1.3, 6.5), new CFrame(0.65, 0, -4.4), BRACKET],
					[new Vector3(0.1, 0.7, 6.2), new CFrame(0.4, 0, -4.4), ICE, NEON],
				),
			),
			...each([-2.4, -4.2, -6], (z) =>
				recoiling(
					[new Vector3(1.9, 0.4, 0.5), new CFrame(0, 0.75, z), WHITE],
					[new Vector3(1.9, 0.4, 0.5), new CFrame(0, -0.75, z), WHITE],
				),
			),
			...recoiling([new Vector3(0.6, 0.6, 0.2), new CFrame(0, 0, -7.5), ICE, NEON]),
		],
		[new CFrame(0, 0, -7.7)],
		0.9,
	],
	// A rocket pod: six glowing tubes on its face, finned.
	swarmer: () => [
		GREEN,
		2.8,
		[
			[new Vector3(3.4, 2.4, 2.8), new CFrame(), GUNMETAL],
			[new Vector3(3.2, 2.2, 0.3), new CFrame(0, 0, -1.5), DARK],
			...recoiling(...POD.map(([x, y]) => tube(0.4, 0.75, new CFrame(x, y, -1.6), GREEN, NEON))),
			...both([new Vector3(0.3, 1.6, 2), new CFrame(1.85, 0, 0.4), GREEN]),
			[new Vector3(1, 0.4, 1), new CFrame(0, 1.4, 0.6), BRACKET],
		],
		POD.map(([x, y]) => new CFrame(x, y, -1.9)),
		0.15,
	],
	// Artillery: four long barrels raised from an amber-plated head.
	ripple: () => [
		AMBER,
		2.3,
		[
			[new Vector3(4.4, 1.4, 3.4), new CFrame(), GUNMETAL],
			[new Vector3(4, 0.4, 2.6), new CFrame(0, 0.85, 0.4), AMBER],
			[new Vector3(4.2, 0.15, 0.3), new CFrame(0, 0.85, -1), AMBER, NEON],
			...both([new Vector3(0.6, 1.4, 3), new CFrame(2.4, 0, 0.2), DARK]),
			...each(ARTILLERY, (barrel) => [
				...recoiling(tube(4.5, 0.75, barrel.mul(new CFrame(0, 0, -2.25)), DARK)),
				tube(0.5, 0.95, barrel.mul(new CFrame(0, 0, -0.6)), AMBER),
			]),
		],
		ARTILLERY.map((barrel) => barrel.mul(new CFrame(0, 0, -4.5))),
		0.8,
	],
	// Twin heavy guns in shoulder housings under gold armour, their barrels ribbed.
	reaper: () => [
		GOLD,
		2.6,
		[
			[new Vector3(3.8, 2, 3.4), new CFrame(), GUNMETAL],
			[new Vector3(3.4, 0.4, 2.8), new CFrame(0, 1.15, 0.2), GOLD],
			...both(
				[new Vector3(0.12, 0.3, 2.6), new CFrame(1.95, 0.4, 0.2), GOLD, NEON],
				[new Vector3(1, 1.4, 2), new CFrame(1.3, -0.1, -1.8), DARK],
				...recoiling(
					tube(4.5, 0.75, new CFrame(1.3, -0.1, -4.6), DARK),
					tube(0.4, 1, new CFrame(1.3, -0.1, -3.6), GOLD),
					tube(0.4, 1, new CFrame(1.3, -0.1, -5.2), GOLD),
					[new Vector3(1.1, 1.1, 0.6), new CFrame(1.3, -0.1, -6.9), GUNMETAL],
				),
			),
		],
		[new CFrame(1.3, -0.1, -7.2), new CFrame(-1.3, -0.1, -7.2)],
		0.6,
	],
	// A colossal railgun: long twin rails glowing gold inside, held by coils, fed by capacitor banks.
	harbinger: () => [
		ORANGE,
		2.5,
		[
			[new Vector3(3.4, 1.8, 4), new CFrame(), GUNMETAL],
			[new Vector3(1, 0.5, 3), new CFrame(0, 1.1, 0.6), ORANGE],
			...both(
				[new Vector3(0.9, 1.6, 2.4), new CFrame(1.6, 0.2, 1.2), DARK],
				[new Vector3(0.1, 1.2, 2), new CFrame(2.06, 0.2, 1.2), ORANGE, NEON],
				...recoiling(
					[new Vector3(0.35, 1.1, 8), new CFrame(0.5, 0.2, -5.8), BRACKET],
					[new Vector3(0.1, 0.6, 7.8), new CFrame(0.3, 0.2, -5.8), GOLD, NEON],
				),
			),
			...each([-2.6, -4.6, -6.6, -8.6], (z) =>
				recoiling(
					[new Vector3(1.6, 0.3, 0.4), new CFrame(0, 0.9, z), ORANGE],
					[new Vector3(1.6, 0.3, 0.4), new CFrame(0, -0.5, z), DARK],
				),
			),
			...recoiling([new Vector3(0.5, 0.5, 0.2), new CFrame(0, 0.2, -9.7), GOLD, NEON]),
		],
		[new CFrame(0, 0.2, -9.9)],
		1.1,
	],
	// A tesla coil: lit rings up a column to an orb, which the lightning leaps from.
	arc: () => [
		CYAN,
		2.1,
		[
			[new Vector3(2.4, 1, 2.4), new CFrame(), GUNMETAL],
			[new Vector3(2.4, 1, 1), splay(0, 1.5, 0, 90), DARK, undefined, Enum.PartType.Cylinder],
			...[0.9, 1.5, 2.1].map((y): Piece => [
				new Vector3(0.25, 1.8, 1.8),
				splay(0, y, 0, 90),
				CYAN,
				NEON,
				Enum.PartType.Cylinder,
			]),
			[new Vector3(1.2, 1.2, 1.2), new CFrame(0, 3, 0), CYAN, NEON, Enum.PartType.Ball],
			[new Vector3(0.3, 0.3, 1.2), new CFrame(0, 2.4, -0.7), BRACKET],
		],
		[new CFrame(0, 3, -0.6)],
	],
	// A great laser: a lens in a violet ring at the end of its emitter, between focusing prongs, heat sinks on top.
	meltdown: () => [
		VIOLET,
		2.8,
		[
			[new Vector3(4, 2.4, 3.6), new CFrame(), GUNMETAL],
			...both([new Vector3(0.6, 2.2, 3.2), new CFrame(2.2, 0, 0.2), VIOLET]),
			...[-1.2, -0.4, 0.4, 1.2].map((x): Piece => [new Vector3(0.2, 0.8, 2.4), new CFrame(x, 1.5, 0.6), DARK]),
			tube(3, 2, new CFrame(0, 0, -3), DARK),
			tube(0.4, 2.4, new CFrame(0, 0, -4.6), VIOLET),
			tube(0.2, 1.6, new CFrame(0, 0, -4.85), PINK, NEON),
			...QUAD.map(([x, y]): Piece => [new Vector3(0.3, 0.3, 2), new CFrame(x * 1.7, y * 1.7, -5.4), BRACKET]),
		],
		[new CFrame(0, 0, -5)],
	],
};
