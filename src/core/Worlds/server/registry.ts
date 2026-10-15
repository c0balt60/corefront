import Log from "@rbxts/log";
import { MemoryStoreService } from "@rbxts/services";

import type { StarSettings } from "core/Worlds/shared/star-system";
import { MAX_PLAYERS, type SaveRef, type WorldSummary } from "core/Worlds/shared/worlds";

/** Seconds an entry outlives its last write. World servers refresh theirs well inside this. */
const ENTRY_TTL = 90;

/** What the registry holds about one world. Server-only: the access code lets anyone into the world. */
export interface WorldEntry extends WorldSummary, StarSettings {
	readonly accessCode: string;
	/** `game.PrivateServerId` of the reserved server, so it can check that an entry is its own. */
	readonly privateServerId: string;
	readonly isPrivate: boolean;
	/** The save slot the world loads from and saves to. */
	readonly save: SaveRef;
}

const worlds = MemoryStoreService.GetSortedMap("Worlds");

/**
 * Every live world across the experience, keyed by join code. The lobby adds a
 * world when it reserves the server. The world server keeps it alive with
 * `setWorldPlayers` and removes it on shutdown. Every call yields, and a
 * MemoryStore failure logs and reads as "nothing there".
 */
export function putWorld(entry: WorldEntry): boolean {
	const [ok, err] = pcall(() => worlds.SetAsync(entry.code, entry, ENTRY_TTL));
	if (!ok) Log.Warn("Could not register world {Code}: {Error}", entry.code, err);
	return ok;
}

export function getWorld(code: string): WorldEntry | undefined {
	const [ok, value] = pcall(() => worlds.GetAsync(code)[0]);
	if (!ok) Log.Warn("Could not read world {Code}: {Error}", code, value);
	return ok ? (value as WorldEntry | undefined) : undefined;
}

/** Refreshes a world's player count and its expiry. Does nothing if the entry is gone. */
export function setWorldPlayers(code: string, players: number) {
	const [ok, err] = pcall(() =>
		worlds.UpdateAsync(
			code,
			(old) => (old !== undefined ? { ...(old as WorldEntry), players } : undefined),
			ENTRY_TTL,
		),
	);
	if (!ok) Log.Warn("Could not update world {Code}: {Error}", code, err);
}

export function removeWorld(code: string) {
	const [ok, err] = pcall(() => worlds.RemoveAsync(code));
	if (!ok) Log.Warn("Could not remove world {Code}: {Error}", code, err);
}

/** Public worlds with room, fullest first. Never includes access codes. */
// ponytail: reads only the first 200 entries; page with exclusiveLowerBound if worlds ever outnumber that.
export function listPublicWorlds(): Array<WorldSummary> {
	const [ok, items] = pcall(() => worlds.GetRangeAsync(Enum.SortDirection.Ascending, 200));
	if (!ok) {
		Log.Warn("Could not list worlds: {Error}", items);
		return [];
	}

	const list = new Array<WorldSummary>();
	for (const { value } of items) {
		const entry = value as WorldEntry;
		if (entry.isPrivate || entry.players >= MAX_PLAYERS) continue;
		list.push({
			code: entry.code,
			hostName: entry.hostName,
			seed: entry.seed,
			players: entry.players,
			sandbox: entry.sandbox,
		});
	}
	list.sort((a, b) => a.players > b.players);
	return list;
}
