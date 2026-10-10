import { SEED_MAX } from "core/Worlds/shared/worlds";

/** Names for the 0-4 levels used by difficulty, aliens and resources. */
export const LEVEL_NAMES = ["Minimal", "Low", "Medium", "High", "Extreme"] as const;

export type PlanetKind = "Habitable" | "Barren" | "Frozen" | "Volcanic";
export type Mission = "defend" | "attack";

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
const OTHER_KINDS: ReadonlyArray<PlanetKind> = ["Barren", "Frozen", "Volcanic"];
const KIND_COLORS: Record<PlanetKind, Color3> = {
	Habitable: Color3.fromRGB(90, 160, 220),
	Barren: Color3.fromRGB(150, 120, 100),
	Frozen: Color3.fromRGB(200, 225, 240),
	Volcanic: Color3.fromRGB(220, 90, 50),
};

/**
 * The star system a world seed makes. Pure and deterministic, so the lobby's
 * preview, the game server and every client agree without sending it around.
 * The first planet is where every world starts: always habitable, easy, and
 * a defend mission. Danger rises with distance from the star.
 */
export function generateStarSystem(seed: number): StarSystem {
	const random = new Random(seed);
	const level = (value: number) => math.clamp(math.round(value), 0, LEVEL_NAMES.size() - 1);

	const star = `${STAR_PREFIXES[random.NextInteger(0, STAR_PREFIXES.size() - 1)]}-${random.NextInteger(10, 999)}`;
	const count = random.NextInteger(4, 7);

	const planets = new Array<Planet>();
	for (let i = 0; i < count; i++) {
		const first = i === 0;
		const kind = first ? "Habitable" : OTHER_KINDS[random.NextInteger(0, OTHER_KINDS.size() - 1)];
		const difficulty = first ? 0 : level(1 + (i / (count - 1)) * 3 + random.NextNumber(-0.6, 0.6));
		const [h, s, v] = KIND_COLORS[kind].ToHSV();

		planets.push({
			name: `${star} ${"bcdefghi".sub(i + 1, i + 1)}`,
			kind,
			difficulty,
			aliens: first ? 0 : level(difficulty + random.NextInteger(-1, 1)),
			resources: level(random.NextInteger(1, 4)),
			mission: first || random.NextNumber() < 0.5 ? "defend" : "attack",
			terrainSeed: random.NextInteger(0, SEED_MAX),
			orbit: 24 + i * 16 + random.NextNumber(0, 6),
			angle: random.NextNumber(0, 2 * math.pi),
			size: first ? 4 : random.NextNumber(2.5, 7),
			color: Color3.fromHSV(h, s, math.clamp(v + random.NextNumber(-0.15, 0.1), 0, 1)),
		});
	}

	return { star, planets };
}

/** The system-wide numbers the Create screen shows. Levels are averages, rounded. */
export function summarizeStarSystem(system: StarSystem) {
	let difficulty = 0;
	let aliens = 0;
	for (const planet of system.planets) {
		difficulty += planet.difficulty;
		aliens += planet.aliens;
	}
	const count = system.planets.size();
	return { planets: count, difficulty: math.round(difficulty / count), aliens: math.round(aliens / count) };
}
