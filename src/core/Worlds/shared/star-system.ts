import { t } from "@rbxts/t";

import { isValidSeed, SEED_MAX } from "core/Worlds/shared/worlds";

/** Names for the 0-4 levels used by difficulty, aliens and resources. */
export const LEVEL_NAMES = ["Minimal", "Low", "Medium", "High", "Extreme"] as const;

/** The fewest and most planets a campaign can be set to. The most is how many planet letters there are. */
export const MIN_PLANETS = 2;
export const MAX_PLANETS = 8;

export type PlanetKind = "Habitable" | "Barren" | "Frozen" | "Volcanic";

/**
 * Everything that decides a star system. The seed rolls whatever is left out;
 * the rest are set by hand on the Create screen. Levels are 0-4 (see `LEVEL_NAMES`).
 */
export interface StarSettings {
	readonly seed: number;
	/** A sandbox world has one planet, of this kind. Undefined for a campaign. */
	readonly sandbox?: PlanetKind;
	readonly planets?: number;
	/** The level the planets' difficulty centres on. The first planet stays the easy start. */
	readonly difficulty?: number;
	readonly aliens?: number;
	readonly resources?: number;
}
export type Mission = "defend" | "attack";

/** Attack missions are off for now: every planet plays as Defense. The admin command `forceattack` still plays one as Attack. */
export const ATTACK_MISSIONS_ENABLED = false;

export interface Planet {
	readonly name: string;
	readonly kind: PlanetKind;
	/** 0-4, see `LEVEL_NAMES`. */
	readonly difficulty: number;
	readonly aliens: number;
	readonly resources: number;
	readonly mission: Mission;
	/** The seed to generate this planet's terrain with (terrain-generator's `Config.seed`). */
	readonly terrainSeed: number;
	/** Distance from the star, in star-map studs. */
	readonly orbit: number;
	/** Where on its orbit the planet sits, in radians. */
	readonly angle: number;
	/** Diameter in star-map studs. */
	readonly size: number;
	readonly color: Color3;
}

export interface StarSystem {
	readonly star: string;
	readonly planets: ReadonlyArray<Planet>;
}

const STAR_PREFIXES = ["Kepler", "TRES", "KELT", "Gliese", "WASP", "TOI", "Ross", "Wolf", "LHS", "HD"];
export const PLANET_KINDS: ReadonlyArray<PlanetKind> = ["Habitable", "Barren", "Frozen", "Volcanic"];
const OTHER_KINDS = PLANET_KINDS.filter((kind) => kind !== "Habitable");
const KIND_COLORS: Record<PlanetKind, Color3> = {
	Habitable: Color3.fromRGB(90, 160, 220),
	Barren: Color3.fromRGB(150, 120, 100),
	Frozen: Color3.fromRGB(200, 225, 240),
	Volcanic: Color3.fromRGB(220, 90, 50),
};

/**
 * The star system a world's settings make. Pure and deterministic, so the lobby's
 * preview, the game server and every client agree without sending it around.
 * The first planet is where every world starts: always habitable, easy, and
 * a defend mission. Danger rises with distance from the star.
 * A `sandbox` world has just that first planet, of the kind given.
 * Every roll is made whether a setting overrides it or not, so changing one
 * setting leaves the rest of the system as it was.
 */
export function generateStarSystem(settings: StarSettings): StarSystem {
	const { sandbox } = settings;
	const random = new Random(settings.seed);
	const level = (value: number) => math.clamp(math.round(value), 0, LEVEL_NAMES.size() - 1);

	const star = `${STAR_PREFIXES[random.NextInteger(0, STAR_PREFIXES.size() - 1)]}-${random.NextInteger(10, 999)}`;
	const rolledCount = random.NextInteger(4, 7);
	const count = settings.planets ?? rolledCount;

	const planets = new Array<Planet>();
	for (let i = 0; i < count; i++) {
		const first = i === 0;
		const kind = first ? "Habitable" : OTHER_KINDS[random.NextInteger(0, OTHER_KINDS.size() - 1)];
		const out = i / (count - 1);
		// Rolled, danger climbs from Low to Extreme. Set, it climbs from a level below the setting to one above.
		const ramp = settings.difficulty !== undefined ? settings.difficulty - 1 + out * 2 : 1 + out * 3;
		const difficulty = first ? 0 : level(ramp + random.NextNumber(-0.6, 0.6));
		const [h, s, v] = KIND_COLORS[kind].ToHSV();
		const aliens = first ? 0 : level((settings.aliens ?? difficulty) + random.NextInteger(-1, 1));
		const resources = random.NextInteger(1, 4);
		// Always rolled, so the rolls after it don't shift when attack missions switch on or off.
		const missionRoll = random.NextNumber();

		planets.push({
			name: `${star} ${"bcdefghi".sub(i + 1, i + 1)}`,
			kind,
			difficulty,
			aliens,
			resources: level(settings.resources ?? resources),
			mission: !first && ATTACK_MISSIONS_ENABLED && missionRoll < 0.5 ? "attack" : "defend",
			terrainSeed: random.NextInteger(0, SEED_MAX),
			orbit: 24 + i * 16 + random.NextNumber(0, 6),
			angle: random.NextNumber(0, 2 * math.pi),
			size: first ? 4 : random.NextNumber(2.5, 7),
			color: Color3.fromHSV(h, s, math.clamp(v + random.NextNumber(-0.15, 0.1), 0, 1)),
		});
	}

	if (sandbox) return { star, planets: [{ ...planets[0], kind: sandbox, color: KIND_COLORS[sandbox] }] };
	return { star, planets };
}

/** The system-wide numbers the Create and Saves screens show: each level as set, or else the planets' average, rounded. */
export function summarizeStarSystem(system: StarSystem, settings: StarSettings) {
	let difficulty = 0;
	let aliens = 0;
	let resources = 0;
	for (const planet of system.planets) {
		difficulty += planet.difficulty;
		aliens += planet.aliens;
		resources += planet.resources;
	}
	const count = system.planets.size();
	return {
		planets: count,
		difficulty: settings.difficulty ?? math.round(difficulty / count),
		aliens: settings.aliens ?? math.round(aliens / count),
		resources: settings.resources ?? math.round(resources / count),
	};
}

const between =
	(min: number, max: number) =>
	(value: unknown): value is number =>
		t.integer(value) && value >= min && value <= max;
const isLevel = t.optional(between(0, LEVEL_NAMES.size() - 1));

/** Settings arrive from clients untyped, so check them with this. Strict, so nothing else gets stored with them. */
export const isStarSettings: t.check<StarSettings> = t.strictInterface({
	seed: isValidSeed,
	sandbox: t.optional((value: unknown): value is PlanetKind => PLANET_KINDS.includes(value as PlanetKind)),
	planets: t.optional(between(MIN_PLANETS, MAX_PLANETS)),
	difficulty: isLevel,
	aliens: isLevel,
	resources: isLevel,
});
