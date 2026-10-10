export interface MatchMode {
	readonly name: string;
	/** The queue starts its countdown once it has this many players. */
	readonly minPlayers: number;
	/** The queue launches straight away at this many players. */
	readonly maxPlayers: number;
	/** Length of a round in seconds. */
	readonly roundLength: number;
}

/** Every mode a player can queue for. The key is sent in teleport data, so keep it stable. */
export const MATCH_MODES = {
	practice: { name: "Practice", minPlayers: 1, maxPlayers: 1, roundLength: 60 },
	duel: { name: "Duel", minPlayers: 2, maxPlayers: 2, roundLength: 120 },
	squads: { name: "Squads", minPlayers: 2, maxPlayers: 8, roundLength: 300 },
} satisfies Record<string, MatchMode>;

export type MatchModeId = keyof typeof MATCH_MODES;

/** The order modes are listed in the lobby. */
export const MATCH_MODE_IDS: ReadonlyArray<MatchModeId> = ["practice", "duel", "squads"];
