/**
 * Everything saved about a player. This is the ProfileStore template, so keep
 * it JSON-safe (no Maps, Sets or Roblox datatypes). It is also replicated to
 * the owning client, so nothing secret belongs here.
 *
 * Adding a field here is enough to roll it out: `Profile.Reconcile` fills it in
 * for existing players.
 */
export interface PlayerData {
	coins: number;
	matchesPlayed: number;
}

export const DEFAULT_PLAYER_DATA: PlayerData = {
	coins: 0,
	matchesPlayed: 0,
};

/** The Charm Sync key a player's data is replicated under. */
export function getDataSyncKey(userId: number): string {
	return `player-data:${userId}`;
}
