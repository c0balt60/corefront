import type { PlanetKind, StarSettings } from "core/Worlds/shared/star-system";

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

/** Save slots each player has. Slots are numbered from 1. */
export const SLOT_COUNT = 3;

/** Which of whose slots a world saves to. */
export interface SaveRef {
	readonly owner: number;
	readonly slot: number;
}

/** A filled save slot as the lobby's Saves page shows it. */
export interface SaveSummary {
	readonly slot: number;
	readonly settings: StarSettings;
	readonly isPrivate: boolean;
	/** How many planets are liberated. */
	readonly conquered: number;
	/** `os.time()` of the last save. */
	readonly savedAt: number;
}

export function isValidSlot(slot: unknown): slot is number {
	return typeIs(slot, "number") && slot % 1 === 0 && slot >= 1 && slot <= SLOT_COUNT;
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
