import type { AlienKind } from "game/Base/shared/base-network";

/** One of a walker's legs: a thigh and a shin, bent at the knee, from its hip on the hull to its foot on the ground. */
export interface Leg {
	/** Where it joins the hull, in the hull's space: the front is -Z. */
	readonly hip: Vector3;
	/** Where its foot rests on the ground, across from the hull: X and Z in the hull's space (Y is ignored). */
	readonly rest: Vector3;
	/** Which way its knee juts, in the hull's space. */
	readonly knee: Vector3;
	/** Legs step in two groups, taking turns: one group only lifts while the other's feet are all down. */
	readonly group: 0 | 1;
}

/** How a walker walks: its legs, how long and thick their bones are, and its stride. */
export interface Gait {
	readonly legs: ReadonlyArray<Leg>;
	readonly thigh: number;
	readonly shin: number;
	readonly width: number;
	/** A flat foot under each shin, if it has them. */
	readonly pad?: Vector3;
	/**
	 * How far a foot falls behind where it rests before it steps, how high it lifts, and the longest a
	 * step takes. Steps quicken as the walker does, to keep up.
	 */
	readonly stride: number;
	readonly lift: number;
	readonly seconds: number;
	/** Each footfall throws up dust. */
	readonly stomp?: true;
}

/** Each side's legs, +X then -X. */
const SIDES = [1, -1];

/** Four legs splayed like a spider's, front and back on each side, knees up and out. Diagonal pairs step together. */
function four(hipX: number, hipY: number, hipZ: number, restX: number, restZ: number): Array<Leg> {
	const legs = new Array<Leg>();
	for (const side of SIDES) {
		for (const row of [-1, 1]) {
			legs.push({
				hip: new Vector3(side * hipX, hipY, row * hipZ),
				rest: new Vector3(side * restX, 0, row * restZ),
				knee: new Vector3(side, 1.2, 0),
				group: side === row ? 0 : 1,
			});
		}
	}
	return legs;
}

/** Six legs splayed like a spider's. Like an insect's, they step in tripods: front and back on one side with the middle on the other. */
function six(hipX: number, hipY: number, hipZ: number, restX: number, restZ: number): Array<Leg> {
	const legs = new Array<Leg>();
	for (const side of SIDES) {
		for (const row of [-1, 0, 1]) {
			legs.push({
				hip: new Vector3(side * hipX, hipY, row * hipZ),
				rest: new Vector3(side * restX, 0, row * restZ),
				knee: new Vector3(side, 1.2, 0),
				group: (side === 1) === (row !== 0) ? 0 : 1,
			});
		}
	}
	return legs;
}

/** Two legs, stepping in turn, their knees bent forward (`knee` -1) or back like a bird's (+1). */
function two(hipX: number, hipY: number, hipZ: number, restX: number, restZ: number, knee: number): Array<Leg> {
	return SIDES.map((side) => ({
		hip: new Vector3(side * hipX, hipY, hipZ),
		rest: new Vector3(side * restX, 0, restZ),
		knee: new Vector3(0, 0, knee),
		group: side === 1 ? 0 : 1,
	}));
}

/**
 * Every walker that walks on legs, which each client draws for itself and plants on the ground as
 * it goes (see `AlienController`); the server only moves the hull, `hover` above the ground (see
 * `WaveService`), so a hip sits that plus its Y up and the legs must reach that far. Tanks roll on treads.
 */
export const ALIEN_GAITS: Partial<Record<AlienKind, Gait>> = {
	crawler: {
		legs: four(1.1, -0.2, 1, 2.4, 1.6),
		thigh: 1.5,
		shin: 1.7,
		width: 0.3,
		stride: 1.8,
		lift: 0.7,
		seconds: 0.15,
	},
	sapper: {
		legs: four(1, -0.3, 0.8, 2.1, 1.3),
		thigh: 1.3,
		shin: 1.4,
		width: 0.28,
		stride: 1.6,
		lift: 0.6,
		seconds: 0.13,
	},
	spitter: {
		legs: two(0.7, -0.9, 0, 0.9, 0, 1),
		thigh: 1.3,
		shin: 1.3,
		width: 0.5,
		pad: new Vector3(0.7, 0.25, 1.1),
		stride: 1.8,
		lift: 0.6,
		seconds: 0.22,
	},
	mortar: {
		legs: four(1.8, -0.5, 1.6, 3.4, 2.4),
		thigh: 2,
		shin: 2.2,
		width: 0.6,
		stride: 2.3,
		lift: 0.8,
		seconds: 0.4,
	},
	shielder: {
		legs: four(1.2, -0.3, 1, 2.5, 1.6),
		thigh: 1.4,
		shin: 1.6,
		width: 0.35,
		stride: 1.7,
		lift: 0.7,
		seconds: 0.2,
	},
	strider: {
		legs: four(1.5, -0.4, 1.5, 3.4, 2.6),
		thigh: 2.6,
		shin: 2.8,
		width: 0.5,
		stride: 2.8,
		lift: 1,
		seconds: 0.3,
	},
	aegis: {
		legs: four(1.3, -0.3, 1.2, 3, 2),
		thigh: 2,
		shin: 2.2,
		width: 0.45,
		stride: 2.2,
		lift: 0.8,
		seconds: 0.25,
	},
	hydra: { legs: six(2.3, -0.5, 2.2, 5, 3.6), thigh: 3, shin: 3.2, width: 0.6, stride: 3, lift: 1.1, seconds: 0.4 },
	fortress: {
		legs: two(2.3, -1.4, 0.2, 2.8, 0.4, 1),
		thigh: 2.8,
		shin: 2.8,
		width: 1.3,
		pad: new Vector3(2, 0.6, 2.8),
		stride: 3,
		lift: 1.4,
		seconds: 0.8,
		stomp: true,
	},
	titan: {
		legs: two(2, -3.4, 0, 2.4, -0.3, -1),
		thigh: 3,
		shin: 3,
		width: 2,
		pad: new Vector3(2.8, 0.8, 4),
		stride: 4,
		lift: 1.6,
		seconds: 0.9,
		stomp: true,
	},
};
