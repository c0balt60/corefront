import { atom } from "@rbxts/charm";

import type { ResourceId } from "game/Base/shared/resources";
import { type Levels, type StatId, statValue } from "game/Research/shared/research";

/*
 * What has been researched in this world, for the life of the server. A module
 * rather than part of `ResearchService`, so the services the stats apply to
 * (Base, Wave, Blaster) can read them without depending on it. Only
 * `ResearchService` writes here, and `SaveService` as a save loads.
 */

/** Each player's own research, by UserId. Kept after they leave, for if they come back. */
export const personal = new Map<number, Levels>();
/** The research on team stats, which every player shares. */
export const teamAtom = atom<Levels>({});
/** Every resource the Core has held. */
export const discoveredAtom = atom<ReadonlyArray<ResourceId>>([]);

/** A player's research, the team's included. */
export function levelsOf(userId: number): Levels {
	return { ...(personal.get(userId) ?? {}), ...teamAtom() };
}

/** A player's value of `stat`. A building's stats are its placer's. */
export function statOf(userId: number, stat: StatId): number {
	return statValue(levelsOf(userId), stat);
}

/** The team's value of a team stat, such as the Core's. Reactive inside Charm's `computed` and `subscribe`. */
export function teamStat(stat: StatId): number {
	return statValue(teamAtom(), stat);
}
