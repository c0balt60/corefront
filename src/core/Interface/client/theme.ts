import type { SpringOptions } from "@rbxts/ripple";

/**
 * The Corefront look, ported from untitled-mindustry-game. Every image id the
 * UI uses is in `IMAGES`, so new uploads only need pasting here.
 */
export const IMAGES = {
	/** The red low-poly backdrop behind the loading screen and menus. */
	background: "rbxassetid://347818442",
	vignette: "rbxassetid://6221578518",
	/** A soft 9-slice drop shadow (a widely used public asset). Swap for your own upload if it disappears. */
	shadow: "rbxassetid://6014261993",
};

/** The 9-slice centre of `IMAGES.shadow`, and how many source pixels its soft edge spans. */
export const SHADOW_SLICE = new Rect(49, 49, 450, 450);
export const SHADOW_EDGE = 49;

/** Ripple spring settings, so motion feels the same everywhere. */
export const SPRINGS = {
	/** Hover, press and small state changes. */
	responsive: { tension: 320, friction: 26 },
	/** Panels and pages moving in and out. */
	smooth: { tension: 170, friction: 26 },
	/** A little overshoot, for pops and toggles. */
	bouncy: { tension: 300, friction: 15 },
} satisfies Record<string, SpringOptions>;

/**
 * The sci-fi effects, as listed per kind of UI in `EFFECTS`.
 * - `energy`: light running round an outline. Without it, the outline is a plain line.
 * - `brackets`: HUD corner brackets.
 * - `scan`: a scan line sweeping down.
 * - `decode`: text unscrambling from random glyphs.
 * - `glitch`: the loading screen title jittering as it appears.
 * - `grid`: the drifting grid over the menu background.
 */
export type Effect = "energy" | "brackets" | "scan" | "decode" | "glitch" | "grid";

/**
 * Which effects each kind of UI gets: the one place to turn them on and off.
 * Every effect takes its kind and does nothing when its kind doesn't list it.
 */
export const EFFECTS = {
	/** `Button` and the menu's RETURN button. */
	button: ["brackets", "decode"],
	/** `Panel`: menu pages, the planet panel and the world header. */
	panel: ["energy", "brackets", "scan"],
	/** `Modal`: the status and error dialogs. */
	dialog: ["energy", "brackets", "scan", "decode"],
	/** The menu's PLAY, STORE, SETTINGS and CHANGELOG cards. */
	card: ["brackets", "scan", "decode"],
	/** The menu's nav bar. */
	nav: ["brackets", "decode"],
	/** Text fields and the private toggle. */
	field: ["energy", "brackets"],
	/** Rows in the join list. */
	row: ["energy", "brackets", "decode"],
	/** Small tags: planet labels on the star map, the planet's status chip and the coin counter. */
	chip: ["energy", "brackets", "scan", "decode"],
	/** Headings, captions and values everywhere else. */
	text: ["decode"],
	/** The loading screen. */
	loading: ["brackets", "decode", "glitch"],
	/** The menu and loading screen backdrop. */
	background: ["scan", "grid"],
	/** The brackets locked onto the selected planet. */
	reticle: ["brackets"],
	/** The in-mission HUD: core status, wave, cargo, toasts and the build bar's cards. */
	hud: ["brackets", "decode"],
	/** The big won or lost banner across the screen. */
	banner: ["brackets", "scan", "decode"],
	/** Developer panels, like the terrain debug panel: plain, so they stay out of the way. */
	debug: ["brackets"],
} satisfies Record<string, readonly Effect[]>;

export type UiKind = keyof typeof EFFECTS;

export function hasEffect(kind: UiKind, effect: Effect) {
	return (EFFECTS[kind] as readonly Effect[]).includes(effect);
}

/** Body text: descriptions, hints and input. */
export const FONT = Font.fromName("SourceSansPro", Enum.FontWeight.SemiBold);
export const FONT_BOLD = Font.fromName("SourceSansPro", Enum.FontWeight.Bold);
/** The sci-fi voice: headings, buttons, labels and numbers, usually upper case. */
export const FONT_DISPLAY = Font.fromName("Montserrat", Enum.FontWeight.Bold);
export const FONT_LABEL = Font.fromName("Montserrat", Enum.FontWeight.Medium);

export const COLORS = {
	/** Salmon red: the logo, underlines and highlights. */
	accent: Color3.fromRGB(244, 121, 110),
	/** Card and panel outlines. */
	stroke: Color3.fromRGB(62, 62, 62),
	/** Behind the background image while it loads. */
	backdrop: Color3.fromRGB(31, 31, 31),
	/** Cards and panels, drawn at `CARD_TRANSPARENCY`. */
	card: new Color3(0, 0, 0),
	/** The gradient a card fades in on hover. */
	cardHover: Color3.fromRGB(63, 48, 48),
	text: new Color3(1, 1, 1),
	muted: Color3.fromRGB(190, 190, 190),
	subtext: Color3.fromRGB(116, 116, 116),
	confirm: Color3.fromRGB(46, 160, 87),
	danger: Color3.fromRGB(214, 76, 76),
	disabled: Color3.fromRGB(70, 70, 70),
};

export const CARD_TRANSPARENCY = 0.5;

/** Text colours for the 0-4 levels in `LEVEL_NAMES`, green to red. */
export const LEVEL_COLORS = [
	Color3.fromRGB(80, 220, 140),
	Color3.fromRGB(160, 220, 90),
	Color3.fromRGB(240, 200, 80),
	Color3.fromRGB(240, 140, 70),
	Color3.fromRGB(235, 70, 70),
];
