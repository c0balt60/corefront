import Log from "@rbxts/log";
import { DataStoreService } from "@rbxts/services";

import { IS_STUDIO } from "core/shared/constants";
import type { StarSettings } from "core/Worlds/shared/star-system";
import { type SaveRef, type SaveSummary, SLOT_COUNT } from "core/Worlds/shared/worlds";

/** Bump the suffix to start everybody's saves over. */
const STORE_NAME = "WorldSaves_v1";

/** What one save slot holds. */
export interface WorldSave {
	readonly settings: StarSettings;
	readonly isPrivate: boolean;
	/** The join code of the world last started from this save. Only that world may write to it. */
	readonly code: string;
	/** `os.time()` of the last write. */
	readonly savedAt: number;
	/** How many planets are liberated, for the Saves page. */
	readonly conquered: number;
	/** The game place's progress (see `SaveService`). Undefined until the world first saves. */
	readonly progress?: unknown;
}

/** None in Studio, so playtests never touch live saves. */
const store = IS_STUDIO ? undefined : DataStoreService.GetDataStore(STORE_NAME);

function keyOf({ owner, slot }: SaveRef): string {
	return `${owner}_${slot}`;
}

/*
 * Save slots, one DataStore key each. The lobby creates and deletes them, the
 * world started from one writes its progress back. Every call yields, and a
 * DataStore failure logs.
 */

/** A slot's save, `undefined` if it's empty, or `false` if it could not be read. */
export function readSave(ref: SaveRef): WorldSave | undefined | false {
	if (!store) return false;
	const [ok, value] = pcall(() => store.GetAsync<WorldSave>(keyOf(ref))[0]);
	if (!ok) Log.Warn("Could not read save {Key}: {Error}", keyOf(ref), value);
	return ok ? value : false;
}

/** A player's filled slots, or `undefined` if any could not be read. Studio has none. */
export function listSaves(owner: number): Array<SaveSummary> | undefined {
	const saves = new Array<SaveSummary>();
	if (!store) return saves;
	for (let slot = 1; slot <= SLOT_COUNT; slot++) {
		const save = readSave({ owner, slot });
		if (save === false) return undefined;
		if (save) {
			const { settings, isPrivate, conquered, savedAt } = save;
			saves.push({ slot, settings, isPrivate, conquered, savedAt });
		}
	}
	return saves;
}

/**
 * Rewrites a slot. `update` gets what's there (`undefined` if empty) and returns
 * the new save, or `undefined` to leave the slot as it is. It may be called more
 * than once. Returns whether a save was written.
 */
export function updateSave(ref: SaveRef, update: (old: WorldSave | undefined) => WorldSave | undefined): boolean {
	if (!store) return false;
	let written = false;
	const [ok, err] = pcall(() =>
		store.UpdateAsync<WorldSave, WorldSave>(keyOf(ref), (old) => {
			const value = update(old);
			written = value !== undefined;
			// Ties the key to its owner for GDPR erasure requests.
			return $tuple(value, [ref.owner]);
		}),
	);
	if (!ok) Log.Warn("Could not write save {Key}: {Error}", keyOf(ref), err);
	return ok && written;
}

export function deleteSave(ref: SaveRef): boolean {
	if (!store) return false;
	const [ok, err] = pcall(() => store.RemoveAsync(keyOf(ref)));
	if (!ok) Log.Warn("Could not delete save {Key}: {Error}", keyOf(ref), err);
	return ok;
}
