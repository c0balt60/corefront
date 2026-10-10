import { t } from "@rbxts/t";

/**
 * Sent by the lobby with every teleport into a world server. Only the join
 * code: the game server reads everything else from the world registry, so a
 * player editing their teleport data cannot change the world.
 */
export interface WorldTeleportData {
	readonly code: string;
}

/** Teleport data arrives untyped, so always check it with this before reading it. */
export const isWorldTeleportData: t.check<WorldTeleportData> = t.interface({
	code: t.string,
});
