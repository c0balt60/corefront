/**
 * Universe and place ids for each environment. The game reads this through
 * `places.ts`, and CI publishes with it (`scripts/publish.mjs`). Keep it plain
 * data with no imports, so Node can load it directly. Find ids in Creator Hub >
 * your experience > Places > Copy ID.
 */
export const ENVIRONMENTS = {
	testing: { universeId: 10770246373, places: { lobby: 91286833219227, game: 122955839998809 } },
	production: { universeId: 10770225279, places: { lobby: 110111062529267, game: 139941081711013 } },
};
