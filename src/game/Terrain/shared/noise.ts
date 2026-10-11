import { Prng } from "game/Terrain/shared/prng";

/**
 * Seeded 2D simplex noise (Gustavson's layout) and fractal helpers, ported
 * exactly from terrain-generator. `math.noise` is fixed-permutation Perlin, so
 * "seeding" it only shifts one world around; a shuffled permutation table per
 * channel gives an independent world per seed. Everything is pure and
 * allocation-free after construction, so workers can call it in parallel.
 */
const F2 = 0.5 * (math.sqrt(3) - 1);
const G2 = (3 - math.sqrt(3)) / 6;

// 12 gradient directions (the cube's edge midpoints); 2D noise uses their x and y.
const GRAD_X = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
const GRAD_Y = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1];

// Octaves are rotated by this angle (a 3-4-5 triangle) so their lattices don't line up.
const ROT_C = 0.8;
const ROT_S = 0.6;

export type Noise2 = (x: number, y: number) => number;
/** Noise value plus its partial derivatives in x and y. */
export type Noise2D = ReturnType<typeof simplex2d>;

export function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = math.clamp((x - edge0) / (edge1 - edge0), 0, 1);
	return t * t * (3 - 2 * t);
}

/** Shuffled permutation for one (seed, salt): `perm[k]` and its gradient index, k in [0, 511]. */
function permutation(seed: number, salt: number): [perm: Array<number>, permGrad: Array<number>] {
	const rng = new Prng(seed, salt);

	const source = new Array<number>(256);
	for (let i = 0; i < 256; i++) source[i] = i;
	for (let i = 255; i >= 1; i--) {
		const j = rng.nextInt(i + 1);
		const swap = source[i];
		source[i] = source[j];
		source[j] = swap;
	}

	const perm = new Array<number>(512);
	const permGrad = new Array<number>(512);
	for (let k = 0; k < 512; k++) {
		const value = source[k % 256];
		perm[k] = value;
		permGrad[k] = value % 12;
	}
	return [perm, permGrad];
}

/** A noise function in roughly [-1, 1]. Same (seed, salt), same function. */
export function simplex2(seed: number, salt: number): Noise2 {
	const [perm, permGrad] = permutation(seed, salt);

	return (xin, yin) => {
		const s = (xin + yin) * F2;
		const i = math.floor(xin + s);
		const j = math.floor(yin + s);
		const t = (i + j) * G2;
		const x0 = xin - (i - t);
		const y0 = yin - (j - t);

		const i1 = x0 > y0 ? 1 : 0;
		const j1 = 1 - i1;

		const x1 = x0 - i1 + G2;
		const y1 = y0 - j1 + G2;
		const x2 = x0 - 1 + 2 * G2;
		const y2 = y0 - 1 + 2 * G2;

		const ii = i % 256;
		const jj = j % 256;

		let n = 0;

		let t0 = 0.5 - x0 * x0 - y0 * y0;
		if (t0 > 0) {
			const g = permGrad[ii + perm[jj]];
			t0 *= t0;
			n += t0 * t0 * (GRAD_X[g] * x0 + GRAD_Y[g] * y0);
		}

		let t1 = 0.5 - x1 * x1 - y1 * y1;
		if (t1 > 0) {
			const g = permGrad[ii + i1 + perm[jj + j1]];
			t1 *= t1;
			n += t1 * t1 * (GRAD_X[g] * x1 + GRAD_Y[g] * y1);
		}

		let t2 = 0.5 - x2 * x2 - y2 * y2;
		if (t2 > 0) {
			const g = permGrad[ii + 1 + perm[jj + 1]];
			t2 *= t2;
			n += t2 * t2 * (GRAD_X[g] * x2 + GRAD_Y[g] * y2);
		}

		return 70 * n;
	};
}

/**
 * Same noise as `simplex2` for the same (seed, salt), plus its analytic
 * derivatives. Each corner contributes t^4 * (g . d) with t = 0.5 - |d|^2,
 * so its gradient is t^4 * g - 8 t^3 * (g . d) * d.
 */
export function simplex2d(seed: number, salt: number) {
	const [perm, permGrad] = permutation(seed, salt);

	return (xin: number, yin: number) => {
		const s = (xin + yin) * F2;
		const i = math.floor(xin + s);
		const j = math.floor(yin + s);
		const t = (i + j) * G2;
		const x0 = xin - (i - t);
		const y0 = yin - (j - t);

		const i1 = x0 > y0 ? 1 : 0;
		const j1 = 1 - i1;

		const x1 = x0 - i1 + G2;
		const y1 = y0 - j1 + G2;
		const x2 = x0 - 1 + 2 * G2;
		const y2 = y0 - 1 + 2 * G2;

		const ii = i % 256;
		const jj = j % 256;

		let n = 0;
		let dx = 0;
		let dy = 0;

		const t0 = 0.5 - x0 * x0 - y0 * y0;
		if (t0 > 0) {
			const g = permGrad[ii + perm[jj]];
			const gx = GRAD_X[g];
			const gy = GRAD_Y[g];
			const gd = gx * x0 + gy * y0;
			const tt = t0 * t0;
			const t4 = tt * tt;
			const k = -8 * tt * t0 * gd;
			n += t4 * gd;
			dx += k * x0 + t4 * gx;
			dy += k * y0 + t4 * gy;
		}

		const t1 = 0.5 - x1 * x1 - y1 * y1;
		if (t1 > 0) {
			const g = permGrad[ii + i1 + perm[jj + j1]];
			const gx = GRAD_X[g];
			const gy = GRAD_Y[g];
			const gd = gx * x1 + gy * y1;
			const tt = t1 * t1;
			const t4 = tt * tt;
			const k = -8 * tt * t1 * gd;
			n += t4 * gd;
			dx += k * x1 + t4 * gx;
			dy += k * y1 + t4 * gy;
		}

		const t2 = 0.5 - x2 * x2 - y2 * y2;
		if (t2 > 0) {
			const g = permGrad[ii + 1 + perm[jj + 1]];
			const gx = GRAD_X[g];
			const gy = GRAD_Y[g];
			const gd = gx * x2 + gy * y2;
			const tt = t2 * t2;
			const t4 = tt * tt;
			const k = -8 * tt * t2 * gd;
			n += t4 * gd;
			dx += k * x2 + t4 * gx;
			dy += k * y2 + t4 * gy;
		}

		return $tuple(70 * n, 70 * dx, 70 * dy);
	};
}

/** Fractal Brownian motion, normalised back to roughly [-1, 1]. */
export function fbm(noise: Noise2, x: number, y: number, octaves: number): number {
	let sum = 0;
	let amplitude = 1;
	let frequency = 1;
	let total = 0;
	for (let octave = 0; octave < octaves; octave++) {
		sum += noise(x * frequency, y * frequency) * amplitude;
		total += amplitude;
		amplitude *= 0.5;
		frequency *= 2;
	}
	return sum / total;
}

/**
 * Ridged multifractal in [0, 1]: sharp crests where the base noise crosses zero.
 * Each octave is weighted by the previous one so detail gathers on the ridges.
 */
export function ridged(noise: Noise2, x: number, y: number, octaves: number): number {
	let sum = 0;
	let amplitude = 0.5;
	let frequency = 1;
	let weight = 1;
	let total = 0;
	for (let octave = 0; octave < octaves; octave++) {
		let signal = 1 - math.abs(noise(x * frequency, y * frequency));
		signal *= signal * weight;
		weight = math.clamp(signal * 2, 0, 1);
		sum += signal * amplitude;
		total += amplitude;
		amplitude *= 0.5;
		frequency *= 2;
	}
	return sum / total;
}

/**
 * Eroded fbm in roughly [-1, 1]. Every octave is damped by the slope the
 * octaves so far have built up (1 / (1 + erosion * |slope|^2)), so fine detail
 * settles on flats and crests while steep flanks stay smooth and pick up
 * streaks running downhill. Octaves average zero, so damping them removes
 * detail without shifting the height. The accumulated slope is rotated back
 * into world orientation so directions agree between rotated octaves.
 */
export function erodedFbm(noise: Noise2D, x: number, y: number, octaves: number, erosion: number): number {
	let sum = 0;
	let total = 0;
	let amplitude = 1;
	let dx = 0;
	let dy = 0;
	let px = x;
	let py = y;
	let c = 1;
	let s = 0;
	for (let octave = 0; octave < octaves; octave++) {
		const [n, gx, gy] = noise(px, py);
		dx += c * gx + s * gy;
		dy += c * gy - s * gx;
		sum += (amplitude * n) / (1 + erosion * (dx * dx + dy * dy));
		total += amplitude;
		amplitude *= 0.5;
		const nx = (ROT_C * px - ROT_S * py) * 2;
		py = (ROT_S * px + ROT_C * py) * 2;
		px = nx;
		const nc = ROT_C * c - ROT_S * s;
		s = ROT_S * c + ROT_C * s;
		c = nc;
	}
	return sum / total;
}

/**
 * Eroded ridged multifractal in [0, 1]. Like `ridged`, each octave is weighted
 * by the previous signal; it is also damped by the slope of the octaves before
 * it (not its own, which would flatten the main crest), giving craggy ridges
 * with smooth flanks. Slope is summed as squared magnitudes because a ridge's
 * slope direction flips on the crest. A damped octave fades toward the
 * previous octave's signal rather than 0, so peaks keep their height.
 */
export function erodedRidged(noise: Noise2D, x: number, y: number, octaves: number, erosion: number): number {
	let sum = 0;
	let total = 0;
	let amplitude = 0.5;
	let weight = 1;
	let previous = 0;
	let slope2 = 0;
	let px = x;
	let py = y;
	for (let octave = 0; octave < octaves; octave++) {
		const [n, gx, gy] = noise(px, py);
		const ridge = 1 - math.abs(n);
		const signal = ridge * ridge * weight;
		const kept = octave === 0 ? signal : previous + (signal - previous) / (1 + erosion * slope2);
		sum += amplitude * kept;
		total += amplitude;
		previous = kept;

		// |d(ridge^2)| = 2 * ridge * |dn|, scaled by this octave's weight.
		const k = 2 * ridge * weight;
		slope2 += k * k * (gx * gx + gy * gy);
		weight = math.clamp(signal * 2, 0, 1);

		amplitude *= 0.5;
		const nx = (ROT_C * px - ROT_S * py) * 2;
		py = (ROT_S * px + ROT_C * py) * 2;
		px = nx;
	}
	return sum / total;
}
