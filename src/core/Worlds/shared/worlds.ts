import type { PlanetKind } from "core/Worlds/shared/star-system";

/** Most players one world server takes. Set the game place's Max Players to the same in Creator Hub. */
export const MAX_PLAYERS = 4;

/** Seeds are terrain-generator seeds (`Config.seed`): integers in [0, SEED_MAX]. */
export const SEED_MAX = 2147483646;

export const CODE_LENGTH = 6;
/** Join code characters, without the look-alikes 0/O and 1/I. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A public world as the lobby's server list shows it. */
export interface WorldSummary {
	readonly code: string;
	readonly hostName: string;
	readonly seed: number;
	readonly players: number;
	/** A sandbox world's one planet's kind (see `generateStarSystem`). Undefined for a campaign. */
	readonly sandbox?: PlanetKind;
}

export function isValidSeed(seed: unknown): seed is number {
	return typeIs(seed, "number") && seed % 1 === 0 && seed >= 0 && seed <= SEED_MAX;
}

export function isValidCode(code: unknown): code is string {
	return (
		typeIs(code, "string") && code.size() === CODE_LENGTH && code.match(`^[${CODE_ALPHABET}]+$`)[0] !== undefined
	);
}

export function randomSeed(): number {
	return new Random().NextInteger(0, SEED_MAX);
}
