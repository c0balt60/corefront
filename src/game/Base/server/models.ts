import { Debris, Workspace } from "@rbxts/services";

import type { AlienKind } from "game/Base/shared/base-network";
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
 * Placeholder art: every building and alien (a war machine) is a handful of
 * parts, built here so the services only deal in gameplay. Swap these for real
 * models later.
 */

const FOUNDATION = Color3.fromRGB(70, 72, 80);
const METAL = Color3.fromRGB(122, 128, 142);
const DARK = Color3.fromRGB(46, 48, 56);
/** The team's accent, on every building. */
const GLOW = Color3.fromRGB(255, 170, 60);
const TITANIUM = Color3.fromRGB(140, 195, 225);
const REPAIR = Color3.fromRGB(110, 230, 120);
const FURNACE = Color3.fromRGB(255, 110, 40);
/** A sorter's, source's or unloader's light with no ore picked. */
const UNSORTED = Color3.fromRGB(235, 235, 240);
/** Power: node tips, links and battery bands. */
const POWER = Color3.fromRGB(255, 228, 90);
const SOLAR = Color3.fromRGB(40, 60, 110);

/** How thick a wall's post is, and how tall it stands above its footprint: thinner than a cell. */
const WALL_WIDTH = 6;
const WALL_HEIGHT = 6;

/** Each turret's barrels, welded to its head: their size, their centres on it, and their tilt up, in degrees. */
const BARRELS: Partial<Record<BuildingKind, readonly [size: Vector3, centres: ReadonlyArray<Vector3>, pitch: number]>> =
	{
		turret: [new Vector3(0.8, 0.8, 4), [new Vector3(0, 0, -3)], 0],
		autoTurret: [new Vector3(0.5, 0.5, 4.4), [new Vector3(-0.55, 0, -3.2), new Vector3(0.55, 0, -3.2)], 0],
		// Twin flak barrels, raised for the sky.
		scatter: [new Vector3(1.1, 1.1, 6), [new Vector3(-1.4, 0.5, -4.5), new Vector3(1.4, 0.5, -4.5)], 30],
		// Six thin barrels in a ring: the gatling.
		vulcan: [
			new Vector3(0.4, 0.4, 6),
			[0, 1, 2, 3, 4, 5].map(
				(i) => new Vector3(math.cos((i * math.pi) / 3) * 0.7, math.sin((i * math.pi) / 3) * 0.7, -4.5),
			),
			0,
		],
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
		// A stubby mortar tube, raised to lob.
		hail: [new Vector3(1.2, 1.2, 3), [new Vector3(0, 0.4, -2)], 35],
		// A short wide nozzle.
		scorch: [new Vector3(1.1, 1.1, 2.6), [new Vector3(0, 0, -2.3)], 0],
		// Three thick prongs side by side.
		fuse: [new Vector3(1, 1, 5), [-2, 0, 2].map((x) => new Vector3(x, 0, -5)), 0],
		// Four barrels in a square.
		salvo: [
			new Vector3(0.7, 0.7, 6),
			[
				new Vector3(-0.8, 0.8, -5.5),
				new Vector3(0.8, 0.8, -5.5),
				new Vector3(-0.8, -0.8, -5.5),
				new Vector3(0.8, -0.8, -5.5),
			],
			0,
		],
		// Twin heavy barrels, fired in turn.
		reaper: [new Vector3(1.6, 1.6, 11), [new Vector3(-2, 0, -9.5), new Vector3(2, 0, -9.5)], 0],
		// One very long rail.
		harbinger: [new Vector3(1.2, 1.2, 18), [new Vector3(0, 0.5, -13)], 0],
		// A short coil the lightning leaps from.
		arc: [new Vector3(0.7, 0.7, 2.2), [new Vector3(0, 0.6, -1.4)], 0],
		// One huge emitter.
		meltdown: [new Vector3(3, 3, 8), [new Vector3(0, 0, -7)], 0],
	};

/** Alien machines: gunmetal hulls and plates, lit red so they never read as the team's. */
const HULL = Color3.fromRGB(58, 60, 68);
const PLATE = Color3.fromRGB(104, 108, 120);
const HOSTILE = Color3.fromRGB(255, 60, 50);
/** A sapper's charge and a bomber's and carrier's bays. */
const CHARGE = Color3.fromRGB(255, 215, 50);
/** A shielder's emitter and its bubble. */
const SHIELD = Color3.fromRGB(255, 110, 90);
const NEON = Enum.Material.Neon;

/** A part welded to an alien's hull: its size, where on the hull, its colour, and its material and shape if not plain metal. */
type Piece = readonly [size: Vector3, at: CFrame, color: Color3, material?: Enum.Material, shape?: Enum.PartType];

/** Each piece, and its mirror image on the hull's other side (-X). */
function both(...pieces: Array<Piece>): Array<Piece> {
	const mirrored = pieces.map(([size, at, color, material, shape]): Piece => {
		const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = at.GetComponents();
		const flipped = new CFrame(-x, y, z, r00, -r01, -r02, -r10, r11, r12, -r20, r21, r22);
		return [size, flipped, color, material, shape];
	});
	return [...pieces, ...mirrored];
}

/** At (x, y, z), tipped `degrees` about the hull's length: at 90, a cylinder (which lies along X) stands as a flat rotor disc. */
function splay(x: number, y: number, z: number, degrees: number): CFrame {
	return new CFrame(x, y, z).mul(CFrame.Angles(0, 0, math.rad(degrees)));
}

/** The mortar's tube on its turntable, raised toward the front. */
const TUBE = new CFrame(0, 0.1, 0).mul(CFrame.Angles(math.rad(50), 0, 0));

/**
 * A turret on an alien's hull, which turns on its own to aim its gun (see `WaveService`'s guns):
 * where it pivots, resting with its front along -Z; how far out of the pivot its gun fires; and its
 * pieces, placed from the pivot. The first piece is the turret itself, on a Motor6D that each client
 * turns (see `AlienController`); the rest are welded to it.
 */
type Turret = readonly [pivot: CFrame, barrel: number, pieces: ReadonlyArray<Piece>];

/** A turret's rest turned to look out of the hull's +X side, or its -X side. */
const RIGHT = CFrame.Angles(0, -math.pi / 2, 0);
const LEFT = CFrame.Angles(0, math.pi / 2, 0);

/** Turrets down both sides of a hull, `x` out and `y` up, one at each of `zs`, looking out: +X's front to back, then -X's. */
function broadside(x: number, y: number, zs: ReadonlyArray<number>, barrel: number, pieces: ReadonlyArray<Piece>) {
	const turrets = new Array<Turret>();
	for (const side of [1, -1]) {
		for (const z of zs) turrets.push([new CFrame(side * x, y, z).mul(side === 1 ? RIGHT : LEFT), barrel, pieces]);
	}
	return turrets;
}

/** A light gun turret: a housing and twin barrels. */
const TWIN_GUN: ReadonlyArray<Piece> = [
	[new Vector3(1.2, 1, 1.2), new CFrame(), PLATE],
	...both([new Vector3(0.3, 0.3, 1.8), new CFrame(0.3, 0, -1.2), DARK]),
];
/** A ball turret under a flier's chin or belly, with one short gun. */
const CHIN_GUN: ReadonlyArray<Piece> = [
	[new Vector3(0.8, 0.8, 0.8), new CFrame(), DARK, undefined, Enum.PartType.Ball],
	[new Vector3(0.25, 0.25, 1.3), new CFrame(0, 0, -0.75), DARK],
	[new Vector3(0.3, 0.3, 0.15), new CFrame(0, 0, -1.45), HOSTILE, NEON],
];

/**
 * Every alien's hull, which the server moves, the pieces on it and the turrets that turn on it. The
 * front is -Z. Walkers' legs aren't here: each client draws them (see `ALIEN_GAITS`). Walkers and
 * tanks stand on the ground at their `hover` (see `ALIENS`); fliers fly that high.
 */
const ALIEN_BODIES: Record<
	AlienKind,
	readonly [hull: Vector3, pieces: ReadonlyArray<Piece>, turrets?: ReadonlyArray<Turret>]
> = {
	// A scout scuttling on four splayed legs.
	crawler: [
		new Vector3(2.6, 1, 3),
		[
			[new Vector3(2, 0.4, 2.2), new CFrame(0, 0.7, 0.2), PLATE, Enum.Material.DiamondPlate],
			[new Vector3(1.6, 0.3, 0.2), new CFrame(0, 0.2, -1.55), HOSTILE, NEON],
		],
	],
	// A squat walking bomb, its charge glowing on its back.
	sapper: [
		new Vector3(2.2, 1.2, 2.4),
		[
			[new Vector3(1.6, 1.6, 1.6), new CFrame(0, 0.8, 0), CHARGE, NEON, Enum.PartType.Ball],
			[new Vector3(1.2, 0.3, 0.2), new CFrame(0, 0.1, -1.25), HOSTILE, NEON],
		],
	],
	// A tank on treads, its twin-gun turret turning to shoot as it drives.
	brute: [
		new Vector3(4.6, 2.4, 5.6),
		[
			[new Vector3(3.6, 0.4, 0.2), new CFrame(0, 0.5, -2.85), HOSTILE, NEON],
			...both([new Vector3(1.2, 1.8, 6.2), new CFrame(2.9, -0.9, 0), DARK, Enum.Material.Fabric]),
		],
		[
			[
				new CFrame(0, 1.9, 0.4),
				4,
				[
					[new Vector3(2.8, 1.4, 2.8), new CFrame(), PLATE, Enum.Material.DiamondPlate],
					...both([new Vector3(0.6, 0.6, 3), new CFrame(0.6, 0, -2.6), DARK]),
				],
			],
		],
	],
	// A walker on bird legs with a gun for an arm, which swings to aim, and a pack on its back.
	spitter: [
		new Vector3(2.4, 2, 2),
		[
			[new Vector3(1.2, 0.4, 0.2), new CFrame(0, 0.4, -1.05), HOSTILE, NEON],
			[new Vector3(1.6, 1.2, 0.8), new CFrame(0, 0.2, 1.4), DARK],
		],
		[
			[
				new CFrame(1.5, 0, 0.1),
				2.3,
				[
					[new Vector3(0.8, 0.8, 0.8), new CFrame(), DARK, undefined, Enum.PartType.Ball],
					[new Vector3(0.5, 0.5, 2.4), new CFrame(0, 0, -1), PLATE],
					[new Vector3(0.6, 0.6, 0.2), new CFrame(0, 0, -2.25), HOSTILE, NEON],
				],
			],
		],
	],
	// Artillery on four legs, its mortar tube raised on a turntable that swings it round to aim.
	mortar: [
		new Vector3(4, 1.8, 4.4),
		[
			[new Vector3(2.4, 0.4, 2.4), new CFrame(0, 1.05, 0.2), PLATE, Enum.Material.DiamondPlate],
			[new Vector3(2.4, 0.35, 0.2), new CFrame(0, 0.2, -2.25), HOSTILE, NEON],
		],
		[
			[
				new CFrame(0, 1.5, 0.2),
				1.8,
				[
					[new Vector3(1.8, 0.5, 1.8), new CFrame(), DARK],
					[new Vector3(1.4, 1.4, 3.4), TUBE, DARK],
					[new Vector3(1.5, 1.5, 0.2), TUBE.mul(new CFrame(0, 0, -1.75)), HOSTILE, NEON],
				],
			],
		],
	],
	// A walker with its shield emitter raised on a mast.
	shielder: [
		new Vector3(2.6, 1.4, 3),
		[
			[new Vector3(0.4, 1.6, 0.4), new CFrame(0, 1.5, 0.3), DARK],
			[new Vector3(1.2, 1.2, 1.2), new CFrame(0, 2.5, 0.3), SHIELD, NEON, Enum.PartType.Ball],
			[new Vector3(1.4, 0.3, 0.2), new CFrame(0, 0.2, -1.55), HOSTILE, NEON],
		],
	],
	// A tall four-legged walker with a gun turret on its back.
	strider: [
		new Vector3(3.4, 1.6, 4),
		[
			[new Vector3(2.8, 0.4, 3), new CFrame(0, 0.95, 0.4), PLATE, Enum.Material.DiamondPlate],
			[new Vector3(2, 0.35, 0.2), new CFrame(0, 0.2, -2.05), HOSTILE, NEON],
			[new Vector3(2, 0.8, 0.6), new CFrame(0, 0.1, 2.3), DARK],
		],
		[
			[
				new CFrame(0, 1.5, 0.2),
				3.3,
				[
					[new Vector3(1.8, 0.7, 1.8), new CFrame(), PLATE],
					[new Vector3(0.4, 0.4, 2.6), new CFrame(0, 0.05, -1.9), DARK],
					[new Vector3(0.5, 0.5, 0.2), new CFrame(0, 0.05, -3.25), HOSTILE, NEON],
				],
			],
		],
	],
	// A walker carrying point defence: a domed turret that shoots shots down in the air.
	aegis: [
		new Vector3(3, 1.4, 3.2),
		[
			[new Vector3(2.4, 0.3, 2.6), new CFrame(0, 0.85, 0), PLATE, Enum.Material.DiamondPlate],
			[new Vector3(1.8, 0.3, 0.2), new CFrame(0, 0.2, -1.65), HOSTILE, NEON],
		],
		[
			[
				new CFrame(0, 1.7, 0),
				1.9,
				[
					[new Vector3(1.6, 1.6, 1.6), new CFrame(), PLATE, undefined, Enum.PartType.Ball],
					[new Vector3(0.5, 0.5, 0.2), new CFrame(0, 0.35, -0.75), CHARGE, NEON],
					...both([new Vector3(0.25, 0.25, 1.6), new CFrame(0.35, 0, -1.1), DARK]),
				],
			],
		],
	],
	// A six-legged spider tank: twin guns up front, a cannon raised in the middle and a rocket pod behind.
	hydra: [
		new Vector3(5, 2, 6.4),
		[
			[new Vector3(4.2, 0.4, 5.4), new CFrame(0, 1.2, 0), PLATE, Enum.Material.DiamondPlate],
			[new Vector3(3, 0.4, 0.2), new CFrame(0, 0.3, -3.25), HOSTILE, NEON],
			[new Vector3(3.6, 1.6, 2), new CFrame(0, -0.2, 4), DARK],
		],
		[
			[
				new CFrame(0, 1.8, -1.9),
				2.3,
				[
					[new Vector3(1.4, 0.6, 1.4), new CFrame(), PLATE],
					...both([new Vector3(0.25, 0.25, 1.8), new CFrame(0.3, 0.05, -1.2), DARK]),
				],
			],
			[
				new CFrame(0, 2.4, 0.7),
				3.9,
				[
					[new Vector3(2.2, 1, 2.2), new CFrame(), PLATE, Enum.Material.DiamondPlate],
					[new Vector3(0.7, 0.7, 3), new CFrame(0, 0.1, -2.2), DARK],
					[new Vector3(0.8, 0.8, 0.2), new CFrame(0, 0.1, -3.75), HOSTILE, NEON],
				],
			],
			[
				new CFrame(0, 1.9, 2.7),
				0.9,
				[
					[new Vector3(1.6, 1, 1.6), new CFrame(), DARK],
					[new Vector3(1.2, 0.6, 0.2), new CFrame(0, 0, -0.85), HOSTILE, NEON],
				],
			],
		],
	],
	// A heavy biped on bird legs: a big cannon on top, and a machine gun turret on each flank.
	fortress: [
		new Vector3(5, 3.4, 4),
		[
			[new Vector3(4, 2, 0.4), new CFrame(0, 0.2, -2.1), PLATE, Enum.Material.DiamondPlate],
			[new Vector3(2.4, 0.4, 0.2), new CFrame(0, 0.9, -2.35), HOSTILE, NEON],
			[new Vector3(3.6, 1.2, 2.6), new CFrame(0, -2.2, 0.2), DARK],
			[new Vector3(2, 1.6, 0.3), new CFrame(0, 0.2, 2.15), HOSTILE, NEON],
		],
		[
			[
				new CFrame(0, 2.2, 0.4),
				4.9,
				[
					[new Vector3(2.8, 1, 2.8), new CFrame(), PLATE, Enum.Material.DiamondPlate],
					[new Vector3(1, 1, 4.2), new CFrame(0, 0.2, -2.6), DARK],
					[new Vector3(1.1, 1.1, 0.2), new CFrame(0, 0.2, -4.75), HOSTILE, NEON],
				],
			],
			...[1, -1].map((side): Turret => [
				new CFrame(side * 3, 0.6, -0.4),
				2.5,
				[
					[new Vector3(1.2, 1.2, 1.4), new CFrame(), PLATE],
					[new Vector3(0.35, 0.35, 2), new CFrame(0, 0, -1.4), DARK],
					[new Vector3(0.4, 0.4, 0.2), new CFrame(0, 0, -2.45), HOSTILE, NEON],
				],
			]),
		],
	],
	// A towering biped with a cannon for each arm, a rocket pod on its shoulder and its reactor glowing on its back.
	titan: [
		new Vector3(7, 4.5, 5),
		[
			[new Vector3(2.6, 1.6, 2.4), new CFrame(0, 3, -0.6), PLATE, Enum.Material.DiamondPlate],
			[new Vector3(2.2, 0.5, 0.2), new CFrame(0, 3, -1.85), HOSTILE, NEON],
			[new Vector3(5, 1.5, 3.5), new CFrame(0, -3, 0), DARK],
			[new Vector3(2.4, 2, 0.3), new CFrame(0, 0.5, 2.55), HOSTILE, NEON],
		],
		[
			...[1, -1].map((side): Turret => [
				new CFrame(side * 4.4, 0.6, 0),
				4.9,
				[
					[new Vector3(2.2, 2, 3), new CFrame(0, 0.6, 0), PLATE, Enum.Material.DiamondPlate],
					[new Vector3(1.4, 1.4, 5), new CFrame(0, -1.2, -2.2), DARK],
					[new Vector3(1.5, 1.5, 0.2), new CFrame(0, -1.2, -4.75), HOSTILE, NEON],
				],
			]),
			[
				new CFrame(2.4, 2.65, 0.8),
				1.2,
				[
					[new Vector3(1.6, 0.8, 1.6), new CFrame(), DARK],
					[new Vector3(1.6, 1.2, 2), new CFrame(0, 0.9, 0), PLATE],
					[new Vector3(1.3, 0.8, 0.2), new CFrame(0, 0.9, -1.05), HOSTILE, NEON],
				],
			],
		],
	],
	// A quadcopter with one red eye and a gun turret slung under it.
	drone: [
		new Vector3(1.8, 0.7, 2.2),
		[
			[new Vector3(0.7, 0.7, 0.7), new CFrame(0, -0.15, -1.1), HOSTILE, NEON, Enum.PartType.Ball],
			[new Vector3(4.2, 0.25, 0.3), new CFrame(0, 0.2, -0.9), DARK],
			[new Vector3(4.2, 0.25, 0.3), new CFrame(0, 0.2, 0.9), DARK],
			// A cylinder lies along X: stood on end, it's a flat rotor disc.
			...both(
				[new Vector3(0.15, 1.8, 1.8), splay(2.1, 0.35, -0.9, 90), PLATE, undefined, Enum.PartType.Cylinder],
				[new Vector3(0.15, 1.8, 1.8), splay(2.1, 0.35, 0.9, 90), PLATE, undefined, Enum.PartType.Cylinder],
			),
		],
		[[new CFrame(0, -0.6, 0.1), 1.4, CHIN_GUN]],
	],
	// A swept-wing interceptor, its chin gun turning to rake whatever it passes.
	wasp: [
		new Vector3(1.6, 0.8, 3.4),
		[
			[new Vector3(0.8, 0.4, 0.8), new CFrame(0, 0.4, -1.1), HOSTILE, NEON],
			[new Vector3(0.15, 0.9, 0.9), new CFrame(0, 0.6, 1.4), PLATE],
			[new Vector3(0.7, 0.5, 0.2), new CFrame(0, 0, 1.75), HOSTILE, NEON],
			...both(
				[new Vector3(2.6, 0.15, 1.4), new CFrame(1.9, 0, 0.5), PLATE, Enum.Material.DiamondPlate],
				[new Vector3(0.2, 0.2, 1), new CFrame(3.2, 0, 0.6), HOSTILE, NEON],
			),
		],
		[[new CFrame(0, -0.65, -0.8), 1.4, CHIN_GUN]],
	],
	// A light gunship on four rotors, a gun turret under its belly and a missile rack on its back.
	hornet: [
		new Vector3(2, 1, 3),
		[
			[new Vector3(1.2, 0.3, 0.2), new CFrame(0, 0.2, -1.55), HOSTILE, NEON],
			[new Vector3(1.6, 0.6, 1.2), new CFrame(0, 0.8, 0.4), DARK],
			[new Vector3(1.4, 0.4, 0.2), new CFrame(0, 0.8, -0.25), HOSTILE, NEON],
			...both(
				[new Vector3(1.6, 0.2, 0.3), new CFrame(1.6, 0.3, -0.9), DARK],
				[new Vector3(1.6, 0.2, 0.3), new CFrame(1.6, 0.3, 0.9), DARK],
				[new Vector3(0.12, 1.6, 1.6), splay(2.4, 0.45, -0.9, 90), PLATE, undefined, Enum.PartType.Cylinder],
				[new Vector3(0.12, 1.6, 1.6), splay(2.4, 0.45, 0.9, 90), PLATE, undefined, Enum.PartType.Cylinder],
			),
		],
		[[new CFrame(0, -0.8, -0.4), 1.4, CHIN_GUN]],
	],
	// A flying wing with an engine under each side and its bomb bay lit.
	bomber: [
		new Vector3(2.4, 1.4, 6),
		[
			[new Vector3(9, 0.3, 2.6), new CFrame(0, 0, 0.6), PLATE, Enum.Material.DiamondPlate],
			[new Vector3(1.4, 0.4, 0.2), new CFrame(0, 0.3, -3.05), HOSTILE, NEON],
			[new Vector3(1.4, 0.2, 2), new CFrame(0, -0.75, 0.4), CHARGE, NEON],
			...both(
				[new Vector3(0.9, 0.9, 1.6), new CFrame(2.6, -0.3, 1.2), DARK],
				[new Vector3(0.7, 0.7, 0.2), new CFrame(2.6, -0.3, 2.05), HOSTILE, NEON],
			),
		],
	],
	// A heavy flier with stub wings, a rocket pod under each tip, a chin gun and a tail fin.
	gunship: [
		new Vector3(3, 1.8, 7),
		[
			[new Vector3(1.6, 0.5, 0.2), new CFrame(0, 0.4, -3.55), HOSTILE, NEON],
			[new Vector3(0.3, 1.6, 1.6), new CFrame(0, 1.4, 3), PLATE],
			...both(
				[new Vector3(4, 0.4, 2.4), new CFrame(3.4, 0, 0.8), PLATE, Enum.Material.DiamondPlate],
				[new Vector3(1.2, 1.2, 2.8), new CFrame(5, -0.6, -0.2), DARK],
				[new Vector3(1, 1, 0.2), new CFrame(5, -0.6, -1.65), HOSTILE, NEON],
				[new Vector3(1, 1, 1.4), new CFrame(1, 0, 3.8), DARK],
				[new Vector3(0.8, 0.8, 0.2), new CFrame(1, 0, 4.55), HOSTILE, NEON],
			),
		],
		[[new CFrame(0, -1.25, -2.4), 1.4, CHIN_GUN]],
	],
	// A bulky transport on four rotors, its cargo bay lit underneath.
	carrier: [
		new Vector3(4.4, 2.6, 8),
		[
			[new Vector3(3.6, 1.2, 5), new CFrame(0, -1.9, 0.2), DARK],
			[new Vector3(3, 0.2, 4), new CFrame(0, -2.55, 0.2), CHARGE, NEON],
			[new Vector3(2.4, 0.5, 0.2), new CFrame(0, 0.4, -4.05), HOSTILE, NEON],
			...both(
				[new Vector3(2.4, 0.4, 0.6), new CFrame(2.8, 1, -2.8), DARK],
				[new Vector3(2.4, 0.4, 0.6), new CFrame(2.8, 1, 2.8), DARK],
				[new Vector3(0.2, 5, 5), splay(3.6, 1.4, -2.8, 90), PLATE, undefined, Enum.PartType.Cylinder],
				[new Vector3(0.2, 5, 5), splay(3.6, 1.4, 2.8, 90), PLATE, undefined, Enum.PartType.Cylinder],
			),
		],
	],
	// A long flying warship, two gun turrets down each side and its bridge at the back.
	frigate: [
		new Vector3(4, 2.4, 11),
		[
			[new Vector3(3.4, 0.4, 9), new CFrame(0, 1.4, 0.4), PLATE, Enum.Material.DiamondPlate],
			[new Vector3(2, 1.2, 2), new CFrame(0, 2.2, 2.6), DARK],
			[new Vector3(1.6, 0.3, 0.2), new CFrame(0, 2.4, 1.55), HOSTILE, NEON],
			[new Vector3(2.6, 0.4, 0.2), new CFrame(0, 0.2, -5.55), HOSTILE, NEON],
			[new Vector3(1, 1.2, 8), new CFrame(0, -1.6, 0), DARK],
			...both(
				[new Vector3(1.2, 1.2, 2), new CFrame(1.6, -0.4, 6), DARK],
				[new Vector3(1, 1, 0.2), new CFrame(1.6, -0.4, 7.05), HOSTILE, NEON],
			),
		],
		broadside(2.6, 0.4, [-2.6, 2], 2.2, TWIN_GUN),
	],
	// A flying battleship: a twin cannon on its bow, gun turrets down both sides, missile racks and a tower aft.
	dreadnought: [
		new Vector3(8, 4, 18),
		[
			[new Vector3(6.6, 0.6, 15), new CFrame(0, 2.3, 0.6), PLATE, Enum.Material.DiamondPlate],
			[new Vector3(3, 2.4, 3.4), new CFrame(0, 3.8, 4.4), DARK],
			[new Vector3(2.6, 0.4, 0.2), new CFrame(0, 4.3, 2.65), HOSTILE, NEON],
			[new Vector3(5, 0.6, 0.2), new CFrame(0, 0.4, -9.05), HOSTILE, NEON],
			[new Vector3(3, 2, 14), new CFrame(0, -2.6, 0), DARK],
			...both(
				[new Vector3(2, 2, 3), new CFrame(3, -0.6, 9.4), DARK],
				[new Vector3(1.8, 1.8, 0.2), new CFrame(3, -0.6, 10.95), HOSTILE, NEON],
				[new Vector3(1.8, 0.8, 2.4), new CFrame(2.4, 3, 1), DARK],
				[new Vector3(1.6, 0.5, 0.2), new CFrame(2.4, 3, -0.25), HOSTILE, NEON],
			),
		],
		[
			[
				new CFrame(0, 3.3, -4.4),
				6.2,
				[
					[new Vector3(3.4, 1.4, 3.4), new CFrame(), PLATE, Enum.Material.DiamondPlate],
					...both(
						[new Vector3(0.9, 0.9, 5), new CFrame(0.6, 0.2, -3.6), DARK],
						[new Vector3(1, 1, 0.2), new CFrame(0.6, 0.2, -6.15), HOSTILE, NEON],
					),
				],
			],
			...broadside(4.6, 0.8, [-3, 3], 2.2, TWIN_GUN),
		],
	],
};

/**
 * A shielder's bubble, `radius` round its hull and welded on. Nothing touches or hits it: the
 * server soaks up damage itself (see `WaveService`).
 */
export function shieldBubble(model: Model, root: BasePart, radius: number): Part {
	const bubble = weld(root, block(model, Vector3.one.mul(radius * 2), root.CFrame, SHIELD, Enum.Material.ForceField));
	bubble.Name = "Shield";
	bubble.Shape = Enum.PartType.Ball;
	bubble.CanQuery = false;
	bubble.CanTouch = false;
	bubble.CastShadow = false;
	return bubble;
}

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

/** What gets a long health bar: the Core and the bosses. */
const WIDE_BARS = new Set<unknown>(["core", "titan", "fortress", "dreadnought"]);

/** Writes `Health` and `MaxHealth`, and shows a bar over the model while it is damaged: a small one, or a wide one over the Core or a Titan. */
export function setHealth(model: Model, health: number, maxHealth: number) {
	model.SetAttribute("Health", health);
	model.SetAttribute("MaxHealth", maxHealth);
	const root = model.PrimaryPart;
	let bar = model.FindFirstChild("HealthBar") as BillboardGui | undefined;
	if (health >= maxHealth || !root) {
		bar?.Destroy();
		return;
	}

	if (!bar) {
		bar = new Instance("BillboardGui");
		bar.Name = "HealthBar";
		bar.Adornee = root;
		const wide = WIDE_BARS.has(model.GetAttribute("Kind"));
		bar.Size = wide ? UDim2.fromOffset(140, 12) : UDim2.fromOffset(44, 6);
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

/** Writes a turret's `Ammo` (shots loaded) and `AmmoType` (the ore it fires next), and shows NO AMMO over it while it has none. */
export function setAmmo(model: Model, shots: number, resource: ResourceId | undefined) {
	model.SetAttribute("Ammo", shots);
	model.SetAttribute("AmmoType", resource);
	warn(model, "NoAmmo", "NO AMMO", shots === 0);
}

/** Writes `Power`, the share of its need a building gets, and shows NO POWER over it while it gets none. */
export function setPower(model: Model, power: number) {
	model.SetAttribute("Power", power);
	warn(model, "NoPower", "NO POWER", power <= 0);
}

/** A red warning over a building, made once as `name`, shown while `shown`. */
function warn(model: Model, name: string, text: string, shown: boolean) {
	const root = model.PrimaryPart;
	if (!root) return;

	let sign = model.FindFirstChild(name) as BillboardGui | undefined;
	if (!sign) {
		sign = new Instance("BillboardGui");
		sign.Name = name;
		sign.Adornee = root;
		sign.Size = UDim2.fromOffset(90, 18);
		sign.StudsOffsetWorldSpace = new Vector3(0, root.Size.Y / 2 + 5, 0);
		sign.MaxDistance = 160;
		const label = new Instance("TextLabel");
		label.BackgroundTransparency = 1;
		label.Size = UDim2.fromScale(1, 1);
		label.Font = Enum.Font.GothamBold;
		label.Text = text;
		label.TextColor3 = Color3.fromRGB(255, 80, 80);
		label.TextSize = 14;
		label.TextStrokeTransparency = 0.4;
		label.Parent = sign;
		sign.Parent = model;
	}
	sign.Enabled = shown;
}

/** Writes a sorter's, source's or unloader's `Filter`, and lights it in that ore's colour (white for none). */
export function setFilter(model: Model, resource: ResourceId | undefined) {
	model.SetAttribute("Filter", resource);
	const light = model.FindFirstChild("Light");
	if (light?.IsA("BasePart")) light.Color = resource !== undefined ? RESOURCES[resource].color : UNSORTED;
}

/** A node's power links, in its model: a thin lit line from `from` to each of `ends`, which nothing touches or hits. */
export function linkLines(model: Model, from: Vector3, ends: ReadonlyArray<Vector3>) {
	for (const child of model.GetChildren()) if (child.Name === "Link") child.Destroy();
	for (const to of ends) {
		const length = to.sub(from).Magnitude;
		const cframe = CFrame.lookAt(from, to).mul(new CFrame(0, 0, -length / 2));
		const line = block(model, new Vector3(0.25, 0.25, length), cframe, POWER, Enum.Material.Neon);
		line.Name = "Link";
		line.CanCollide = false;
		line.CanQuery = false;
		line.CanTouch = false;
		line.CastShadow = false;
	}
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
	} else if (kind === "source") {
		// Small, like a belt: a low plinth under a crystal on its point, in its ore's colour (see `setFilter`).
		// Not neon: neon washes pale ores like lead out to white.
		body = block(model, new Vector3(4.5, 1.5, 4.5), at(0.75), DARK, Enum.Material.Metal);
		block(model, new Vector3(4.7, 0.3, 4.7), at(1.2), GLOW, Enum.Material.Neon);
		const tilt = CFrame.Angles(math.rad(45), 0, math.rad(45));
		block(model, new Vector3(1.8, 1.8, 1.8), at(2.9).mul(tilt), UNSORTED, Enum.Material.SmoothPlastic).Name =
			"Light";
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
	} else if (def.node !== undefined) {
		// A pole on a plate with a crossbar, lit at its tip, where its links run from (see `linkLines`).
		const scale = def.size;
		const tall = 7 * scale;
		body = block(model, new Vector3(3, 1, 3).mul(scale), at(0.5), DARK, Enum.Material.Metal);
		block(model, new Vector3(0.8 * scale, tall, 0.8 * scale), at(1 + tall / 2), METAL, Enum.Material.Metal);
		block(model, new Vector3(3.5 * scale, 0.5, 0.6), at(tall - 0.5), METAL, Enum.Material.Metal);
		const tip = block(model, Vector3.one.mul(1.4 * scale), at(1 + tall + 0.7 * scale), POWER, Enum.Material.Neon);
		tip.Name = "Tip";
		tip.Shape = Enum.PartType.Ball;
	} else if (kind === "solarPanel") {
		// A panel on a post, tipped toward the sun.
		body = block(model, new Vector3(5, 1, 5), at(0.5), DARK, Enum.Material.Metal);
		block(model, new Vector3(1, 1.5, 1), at(1.75), METAL, Enum.Material.Metal);
		const tilt = CFrame.Angles(math.rad(-15), 0, 0);
		block(model, new Vector3(7, 0.3, 7), at(2.8).mul(tilt), SOLAR, Enum.Material.Glass);
	} else if (def.battery !== undefined) {
		// A cell with bands of charge round it, and its terminal on top.
		const width = def.size * CELL_STUDS - 2;
		const height = 2 + def.size * 2;
		body = block(model, new Vector3(width, height, width), at(height / 2), DARK, Enum.Material.Metal);
		for (const y of [height * 0.35, height * 0.7]) {
			block(model, new Vector3(width + 0.2, 0.4, width + 0.2), at(y), POWER, Enum.Material.Neon);
		}
		block(model, new Vector3(width / 3, 0.8, width / 3), at(height + 0.4), METAL, Enum.Material.Metal);
	} else if (def.store !== undefined) {
		// A crate with a band across it.
		const width = def.size * CELL_STUDS - 1;
		const height = 3 + def.size * 1.5;
		body = block(model, new Vector3(width, height, width), at(height / 2), METAL, Enum.Material.DiamondPlate);
		block(model, new Vector3(width + 0.2, 0.5, width + 0.2), at(height - 0.6), GLOW, Enum.Material.Neon);
		block(model, new Vector3(width + 0.2, 0.8, width / 3), at(height / 2), DARK, Enum.Material.Metal);
	} else if (kind === "unloader") {
		body = block(model, new Vector3(5, 2.5, 5), at(1.25), METAL, Enum.Material.DiamondPlate);
		block(model, new Vector3(5.3, 0.5, 5.3), at(0.6), GLOW, Enum.Material.Neon);
		// Lit in the colour of the ore it takes (see `setFilter`).
		block(model, new Vector3(2.4, 1, 2.4), at(3), UNSORTED, Enum.Material.Neon).Name = "Light";
	} else if (def.generator || def.craft) {
		// Generators and the other crafters: a banded housing, its works glowing on top in what it makes, or its fire.
		const width = def.size * CELL_STUDS - 3;
		const height = 2 + def.size * 2;
		const works = oreColor ?? (kind === "rtgGenerator" ? RESOURCES.thorium.color : FURNACE);
		body = block(model, new Vector3(width, height, width), at(height / 2), METAL, Enum.Material.DiamondPlate);
		block(model, new Vector3(width + 0.2, 0.5, width + 0.2), at(height - 0.8), GLOW, Enum.Material.Neon);
		block(model, new Vector3(width / 2.5, 1, width / 2.5), at(height + 0.5), works, Enum.Material.Neon);
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
 * An alien: an anchored hull the server moves with `BulkMoveTo`, the pieces welded to it, and its
 * turrets, `Turret0` on, each on a Motor6D named `Mount` (see `ALIEN_BODIES`). Nothing collides, so
 * moving it never shoves players.
 */
export function alienModel(kind: AlienKind, cframe: CFrame): [model: Model, root: Part] {
	const model = new Instance("Model");
	model.Name = kind;
	// Whole or not at all, so a client never rigs half an alien (see `AlienController`).
	model.ModelStreamingMode = Enum.ModelStreamingMode.Atomic;
	const [hull, pieces, turrets = []] = ALIEN_BODIES[kind];
	const root = block(model, hull, cframe, HULL, Enum.Material.Metal);
	root.CanCollide = false;
	root.CanTouch = false;
	const piece = ([size, at, color, material, shape]: Piece, from: CFrame) => {
		const part = block(model, size, from.mul(at), color, material ?? Enum.Material.Metal);
		if (shape) part.Shape = shape;
		return part;
	};
	for (const each of pieces) weld(root, piece(each, cframe));
	turrets.forEach(([pivot, , turretPieces], index) => {
		const from = cframe.mul(pivot);
		const body = turretPieces[0];
		const turret = piece(body, from);
		turret.Name = `Turret${index}`;
		turret.Anchored = false;
		turret.Massless = true;
		turret.CanCollide = false;
		const mount = new Instance("Motor6D");
		mount.Name = "Mount";
		mount.Part0 = root;
		mount.Part1 = turret;
		mount.C0 = pivot;
		mount.C1 = body[1].Inverse();
		mount.Parent = turret;
		for (const each of turretPieces) if (each !== body) weld(turret, piece(each, from));
	});
	model.PrimaryPart = root;
	return [model, root];
}

/** Where each of an alien's turrets pivots on its hull, and how far out of the pivot its gun fires (see `Turret`). */
export function alienTurrets(kind: AlienKind): ReadonlyArray<readonly [pivot: CFrame, barrel: number]> {
	return (ALIEN_BODIES[kind][2] ?? []).map(([pivot, barrel]) => [pivot, barrel]);
}
