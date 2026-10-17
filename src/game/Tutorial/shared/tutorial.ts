/**
 * The tutorial, in order. A player's saved progress (`PlayerData.tutorial`) is the index of the step they are on,
 * and `TUTORIAL_DONE` once they've finished. Steps:
 *
 * - `deploy`: deploy to the planet from the star map.
 * - `drill`: place a drill on the copper nearest the Core.
 * - `conveyor`: belt that ore into the Core: a line of belts from a drill reaches it. A guide marks where to lay it.
 * - `shoot`: shoot the practice aliens with the Blaster. The server completes it, once they are all gone.
 * - `research`: research the Turret, which costs Core resources.
 * - `turret`: place a turret, on the spot a guide marks toward the nearest drop zone.
 * - `ammo`: build a drill on copper near the turret and belt it into the turret. Loading it by hand does not count.
 * - `defend`: survive the waves. Ends when the planet is liberated.
 * - `travel`: open the star map, pick the next planet and launch.
 *
 * The client sends `Advance` as it sees each step done, except `shoot`.
 */
export const TUTORIAL_STEPS = [
	"deploy",
	"drill",
	"conveyor",
	"shoot",
	"research",
	"turret",
	"ammo",
	"defend",
	"travel",
] as const;

export type TutorialStep = (typeof TUTORIAL_STEPS)[number];

/** The progress of a player who has finished (or skipped) the tutorial. */
export const TUTORIAL_DONE = TUTORIAL_STEPS.size();

/** A step's place in the tutorial, which is the progress of a player who is on it. */
export function stepIndex(id: TutorialStep): number {
	return TUTORIAL_STEPS.indexOf(id);
}

/** Parts of the game the tutorial holds back until its step. */
export type TutorialLock = "blaster" | "research" | "callWave" | "starMap";

/** The step each lock opens at. */
const UNLOCKS: Readonly<Record<TutorialLock, TutorialStep>> = {
	blaster: "shoot",
	research: "research",
	callWave: "defend",
	// The ground star map: the one before deploying is never locked.
	starMap: "travel",
};

/** Whether a player at `progress` may use `lock`. */
export function isUnlocked(progress: number, lock: TutorialLock): boolean {
	return progress >= stepIndex(UNLOCKS[lock]);
}
