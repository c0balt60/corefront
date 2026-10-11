/**
 * Deterministic Park-Miller (MINSTD) generator, ported from terrain-generator.
 * Roblox's `Random` gives no guarantee across engine versions, and every worker
 * and the main thread must agree on the same streams. The largest intermediate
 * product (2^31 * 48271) stays well under 2^53, so plain doubles are exact.
 */
const MODULUS = 2147483647;
const MULTIPLIER = 48271;

function step(state: number): number {
	return (state * MULTIPLIER) % MODULUS;
}

export class Prng {
	private state: number;

	/** Folds any integer seed and a salt into a valid non-zero state, so each salt gets its own stream. */
	constructor(seed: number, salt = 0) {
		let state = ((math.floor(seed) + math.floor(salt) * 1013904223) % (MODULUS - 1)) + 1;
		for (let i = 0; i < 4; i++) state = step(state);
		this.state = state;
	}

	/** Uniform integer in [0, n). */
	nextInt(n: number): number {
		this.state = step(this.state);
		return this.state % n;
	}

	/** Uniform float in [0, 1). */
	nextNumber(): number {
		this.state = step(this.state);
		return (this.state - 1) / (MODULUS - 1);
	}
}
