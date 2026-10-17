import { CORES, type CoreKind } from "game/Base/shared/buildings";

export type BlasterKind = "blaster" | "mender" | "twin" | "flamer" | "rail" | "arc" | "mortar";

/**
 * A Blaster a player can pick at the Core, Mindustry style, where each core unit's gun is its own: it
 * comes with `core` and every tier after. Each shot is a projectile: bullets fly straight, flames are
 * slow and short, shells arc down on where they're aimed, and arcs strike the alien nearest the aim
 * at once, jumping on to `chain` more. `damage` per hit, seconds between shots, and studs it reaches.
 * Each shot fires `volley` at a time, fanned `fan` degrees apart; bullets fly on through `pierce` more
 * aliens after the first, and flames and shells blast `splash` studs round where they land. A bullet
 * that hits a building gives it `repair` health back. `size` is how big a bullet looks, against a
 * turret's 1, and `color` its tracer's.
 */
export interface BlasterDef {
	readonly name: string;
	readonly description: string;
	readonly core: CoreKind;
	readonly projectile: "bullet" | "flame" | "shell" | "arc";
	readonly damage: number;
	readonly seconds: number;
	readonly range: number;
	readonly volley?: number;
	readonly fan?: number;
	readonly pierce?: number;
	readonly splash?: number;
	readonly chain?: number;
	readonly repair?: number;
	readonly size?: number;
	readonly color: Color3;
}

export const BLASTERS: Record<BlasterKind, BlasterDef> = {
	blaster: {
		name: "Blaster",
		description: "A steady all-rounder.",
		core: "core",
		projectile: "bullet",
		damage: 15,
		seconds: 0.25,
		range: 300,
		size: 0.7,
		color: Color3.fromRGB(255, 211, 127),
	},
	mender: {
		name: "Mender",
		description: "Weaker bolts that patch up any building they hit.",
		core: "core",
		projectile: "bullet",
		damage: 9,
		seconds: 0.35,
		range: 300,
		repair: 15,
		size: 0.6,
		color: Color3.fromRGB(132, 236, 130),
	},
	twin: {
		name: "Twin Blaster",
		description: "Two barrels, a little spread, and a faster trigger.",
		core: "coreFoundation",
		projectile: "bullet",
		damage: 14,
		seconds: 0.2,
		range: 300,
		volley: 2,
		fan: 4,
		size: 0.8,
		color: Color3.fromRGB(255, 186, 96),
	},
	flamer: {
		name: "Flamer",
		description: "Licks of flame that scorch everything round where they land. Short reach.",
		core: "coreFoundation",
		projectile: "flame",
		damage: 6,
		seconds: 0.08,
		range: 32,
		splash: 4,
		color: Color3.fromRGB(255, 140, 60),
	},
	rail: {
		name: "Rail Blaster",
		description: "Heavy slugs that punch through a line of aliens.",
		core: "coreNucleus",
		projectile: "bullet",
		damage: 36,
		seconds: 0.15,
		range: 300,
		pierce: 2,
		size: 1,
		color: Color3.fromRGB(140, 200, 255),
	},
	arc: {
		name: "Arc Caster",
		description: "Lightning that strikes the alien nearest where you aim, and leaps on through those near it.",
		core: "coreNucleus",
		projectile: "arc",
		damage: 20,
		seconds: 0.4,
		range: 60,
		chain: 3,
		color: Color3.fromRGB(170, 190, 255),
	},
	mortar: {
		name: "Mortar",
		description: "Lobs slow shells that blast an area where they come down.",
		core: "coreNucleus",
		projectile: "shell",
		damage: 45,
		seconds: 1.2,
		range: 150,
		splash: 8,
		color: Color3.fromRGB(255, 160, 90),
	},
};

export const BLASTER_ORDER: ReadonlyArray<BlasterKind> = [
	"blaster",
	"mender",
	"twin",
	"flamer",
	"rail",
	"arc",
	"mortar",
];

/** The Blasters a Core of tier `core` lets players pick from. */
export function blastersOf(core: CoreKind): ReadonlyArray<BlasterKind> {
	return BLASTER_ORDER.filter((kind) => CORES.indexOf(BLASTERS[kind].core) <= CORES.indexOf(core));
}

/** The Blaster a player who picked `picked` (a Player's `Blaster` attribute) fires under a Core of tier `core`: the plain one until they pick, or if theirs isn't there. */
export function blasterOf(picked: unknown, core: CoreKind): BlasterKind {
	return blastersOf(core).includes(picked as BlasterKind) ? (picked as BlasterKind) : "blaster";
}
