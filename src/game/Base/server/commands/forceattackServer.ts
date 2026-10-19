import { Dependency } from "@flamework/core";

import { PlanetsService } from "game/Planets/server/PlanetsService";

export = function () {
	const planets = Dependency<PlanetsService>();
	const planet = planets.activeAtom();
	if (planet === undefined) return "No planet is active.";
	if (planets.travelAtom()) return "The team is travelling.";

	// Restarts it the way a landing does: the terrain regenerates and the base is rebuilt.
	planets.forceMission(planet, "attack");
	planets.activate(planet);
	return "Planet is now an attack mission, restarted.";
};
