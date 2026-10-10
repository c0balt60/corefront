import { ENVIRONMENTS } from "core/Teleport/shared/environments";

function findPlaceIds() {
	for (const [, environment] of pairs(ENVIRONMENTS)) {
		if (environment.universeId !== 0 && environment.universeId === game.GameId) return environment.places;
	}
	return { lobby: 0, match: 0 };
}

/**
 * Place ids for the universe this server runs in. Outside a listed universe (Studio,
 * an unpublished place), every id is 0 and teleports are skipped.
 */
export const PLACE_IDS = findPlaceIds();
