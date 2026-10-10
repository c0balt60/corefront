/**
 * Universe and place ids for each environment. The game reads this through
 * `places.ts`, and CI publishes with it (`scripts/publish.mjs`). Keep it plain
 * data with no imports, so Node can load it directly. Find ids in Creator Hub >
 * your experience > Places > Copy ID.
 */
export const ENVIRONMENTS = {
	staging: { universeId: 0, places: { lobby: 0, match: 0 } },
	production: { universeId: 0, places: { lobby: 0, match: 0 } },
};
