import { t } from "@rbxts/t";

import { MATCH_MODES, type MatchModeId } from "core/Teleport/shared/match-modes";

/** Sent by the lobby with every teleport into a match. */
export interface MatchTeleportData {
	readonly mode: MatchModeId;
	/** Everyone sent to the server, so the match knows when the last of them has arrived. */
	readonly userIds: ReadonlyArray<number>;
}

/** Teleport data arrives untyped, so always check it with this before reading it. */
export const isMatchTeleportData: t.check<MatchTeleportData> = t.interface({
	mode: t.keyOf(MATCH_MODES),
	userIds: t.array(t.integer),
});
