import Vide from "@rbxts/vide";

import type { GlyphId } from "game/Research/shared/research";

/** A filled rectangle on a 12×12 grid: x, y, width, height. `cut` paints it in the background, to punch holes. */
type Rect = readonly [x: number, y: number, w: number, h: number, cut?: "cut"];

const GRID = 12;

/** Pixel-art icons, painted in order. Keep to the grid so they stay crisp at every zoom. */
const GLYPHS: Record<GlyphId, ReadonlyArray<Rect>> = {
	core: [
		[1, 1, 10, 10],
		[3, 3, 6, 6, "cut"],
		[5, 5, 2, 2],
		[0, 5, 1, 2],
		[11, 5, 1, 2],
		[5, 0, 2, 1],
		[5, 11, 2, 1],
	],
	lock: [
		[4, 1, 4, 1],
		[3, 2, 1, 3],
		[8, 2, 1, 3],
		[2, 5, 8, 6],
		[5, 7, 2, 2, "cut"],
	],
	coreFoundation: [
		[0, 0, 12, 12],
		[1, 1, 10, 10, "cut"],
		[2, 2, 8, 8],
		[4, 4, 4, 4, "cut"],
		[5, 5, 2, 2],
	],
	coreNucleus: [
		[2, 2, 8, 8],
		[4, 4, 4, 4, "cut"],
		[5, 5, 2, 2],
		[0, 0, 2, 2],
		[10, 0, 2, 2],
		[0, 10, 2, 2],
		[10, 10, 2, 2],
		[5, 0, 2, 1],
		[5, 11, 2, 1],
		[0, 5, 1, 2],
		[11, 5, 1, 2],
	],
	remove: [
		[1, 1, 2, 2],
		[3, 3, 2, 2],
		[5, 5, 2, 2],
		[7, 7, 2, 2],
		[9, 9, 2, 2],
		[9, 1, 2, 2],
		[7, 3, 2, 2],
		[3, 7, 2, 2],
		[1, 9, 2, 2],
	],
	drill: [
		[2, 0, 8, 3],
		[3, 3, 6, 3],
		[4, 6, 4, 3],
		[5, 9, 2, 3],
	],
	advancedDrill: [
		[0, 0, 8, 3],
		[1, 3, 6, 3],
		[2, 6, 4, 3],
		[3, 9, 2, 3],
		[9, 5, 2, 6],
		[7, 7, 6, 2],
	],
	laserDrill: [
		[1, 0, 10, 4],
		[3, 1, 6, 2, "cut"],
		[4, 4, 4, 2],
		[5, 6, 2, 6],
	],
	drillBits: [
		[3, 1, 6, 10],
		[1, 3, 10, 6],
		[5, 0, 2, 12],
		[0, 5, 12, 2],
		[5, 5, 2, 2, "cut"],
	],
	graphitePress: [
		[8, 0, 2, 3],
		[1, 3, 10, 9],
		[3, 6, 6, 4, "cut"],
		[5, 8, 2, 2],
	],
	siliconSmelter: [
		[1, 0, 2, 3],
		[9, 0, 2, 3],
		[0, 3, 12, 9],
		[2, 5, 8, 5, "cut"],
		[4, 6, 4, 3],
		[5, 7, 2, 1, "cut"],
	],
	router: [
		[3, 3, 6, 6],
		[5, 5, 2, 2, "cut"],
		[5, 0, 2, 3],
		[5, 9, 2, 3],
		[0, 5, 3, 2],
		[9, 5, 3, 2],
	],
	sorter: [
		[0, 5, 5, 2],
		[5, 1, 2, 10],
		[7, 5, 5, 2],
		[7, 1, 4, 2],
		[7, 9, 4, 2],
	],
	junction: [
		[0, 3, 12, 2],
		[0, 7, 12, 2],
		[3, 0, 2, 12],
		[7, 0, 2, 12],
		[5, 5, 2, 2],
	],
	// One chevron; the Titanium Conveyor, faster, has two.
	conveyor: [
		[0, 0, 12, 1],
		[0, 11, 12, 1],
		[4, 3, 2, 2],
		[6, 5, 2, 2],
		[4, 7, 2, 2],
	],
	titaniumConveyor: [
		[0, 0, 12, 1],
		[0, 11, 12, 1],
		[1, 3, 2, 2],
		[3, 5, 2, 2],
		[1, 7, 2, 2],
		[6, 3, 2, 2],
		[8, 5, 2, 2],
		[6, 7, 2, 2],
	],
	// Infinity: it never runs out.
	source: [
		[1, 3, 3, 1],
		[8, 3, 3, 1],
		[0, 4, 1, 4],
		[11, 4, 1, 4],
		[4, 4, 1, 1],
		[7, 4, 1, 1],
		[5, 5, 2, 2],
		[4, 7, 1, 1],
		[7, 7, 1, 1],
		[1, 8, 3, 1],
		[8, 8, 3, 1],
	],
	wall: [
		[0, 1, 5, 3],
		[6, 1, 6, 3],
		[0, 5, 2, 3],
		[3, 5, 6, 3],
		[10, 5, 2, 3],
		[0, 9, 5, 2],
		[6, 9, 6, 2],
	],
	titaniumWall: [
		[0, 0, 12, 5],
		[0, 7, 12, 5],
		[2, 2, 1, 1, "cut"],
		[9, 2, 1, 1, "cut"],
		[2, 9, 1, 1, "cut"],
		[9, 9, 1, 1, "cut"],
	],
	plating: [
		[0, 0, 8, 2],
		[0, 0, 2, 8],
		[4, 4, 8, 8],
		[6, 6, 4, 4, "cut"],
	],
	mender: [
		[4, 0, 4, 12],
		[0, 4, 12, 4],
		[5, 1, 2, 10, "cut"],
		[1, 5, 10, 2, "cut"],
		[5, 5, 2, 2],
	],
	turret: [
		[5, 0, 2, 4],
		[3, 3, 6, 4],
		[1, 7, 10, 4],
	],
	autoTurret: [
		[3, 0, 2, 4],
		[7, 0, 2, 4],
		[2, 3, 8, 4],
		[1, 7, 10, 4],
		[5, 4, 2, 2, "cut"],
	],
	scatter: [
		[2, 0, 2, 5],
		[8, 0, 2, 5],
		[1, 4, 10, 3],
		[0, 7, 12, 5],
		[5, 8, 2, 2, "cut"],
	],
	// A ring of barrels, end on.
	vulcan: [
		[3, 0, 2, 5],
		[7, 0, 2, 5],
		[5, 1, 2, 4],
		[2, 4, 8, 3],
		[0, 7, 12, 5],
		[5, 8, 2, 2, "cut"],
	],
	cannon: [
		[4, 0, 4, 5],
		[2, 4, 8, 4],
		[0, 7, 12, 5],
	],
	swarmer: [
		[1, 1, 10, 10],
		[3, 3, 2, 2, "cut"],
		[7, 3, 2, 2, "cut"],
		[3, 7, 2, 2, "cut"],
		[7, 7, 2, 2, "cut"],
	],
	ripple: [
		[1, 0, 1, 5],
		[4, 0, 1, 5],
		[7, 0, 1, 5],
		[10, 0, 1, 5],
		[0, 4, 12, 3],
		[1, 7, 10, 5],
	],
	// A stubby mortar tube, raised.
	hail: [
		[7, 0, 3, 2],
		[6, 2, 3, 2],
		[5, 4, 3, 2],
		[2, 6, 8, 2],
		[1, 8, 10, 4],
	],
	// A nozzle, flame licking out of it.
	scorch: [
		[5, 0, 2, 1],
		[4, 1, 4, 2],
		[5, 3, 2, 1],
		[4, 4, 4, 3],
		[2, 7, 8, 5],
		[5, 9, 2, 1, "cut"],
	],
	// Three prongs.
	fuse: [
		[1, 0, 2, 5],
		[5, 0, 2, 5],
		[9, 0, 2, 5],
		[1, 4, 10, 3],
		[0, 7, 12, 5],
		[5, 8, 2, 2, "cut"],
	],
	// Four barrels, end on.
	salvo: [
		[2, 0, 3, 3],
		[7, 0, 3, 3],
		[2, 3, 3, 2],
		[7, 3, 3, 2],
		[3, 1, 1, 1, "cut"],
		[8, 1, 1, 1, "cut"],
		[1, 5, 10, 2],
		[0, 7, 12, 5],
	],
	// Twin heavy barrels with muzzle brakes.
	reaper: [
		[2, 0, 3, 1],
		[7, 0, 3, 1],
		[3, 1, 1, 4],
		[8, 1, 1, 4],
		[1, 4, 10, 4],
		[4, 5, 4, 2, "cut"],
		[0, 8, 12, 4],
	],
	// One very long rail.
	harbinger: [
		[4, 0, 4, 1],
		[5, 1, 2, 6],
		[3, 6, 6, 3],
		[5, 7, 2, 1, "cut"],
		[0, 9, 12, 3],
	],
	// A tesla coil, sparking.
	arc: [
		[4, 0, 4, 3],
		[0, 1, 2, 1],
		[10, 1, 2, 1],
		[5, 3, 2, 5],
		[3, 4, 6, 1],
		[3, 6, 6, 1],
		[1, 8, 10, 4],
	],
	// A wide lens, its beam straight up.
	meltdown: [
		[5, 0, 2, 4],
		[2, 3, 8, 5],
		[4, 4, 4, 3, "cut"],
		[5, 5, 2, 1],
		[0, 8, 12, 4],
	],
	// A crate with a handle and a band.
	container: [
		[3, 0, 6, 2],
		[0, 2, 12, 9],
		[2, 4, 8, 5, "cut"],
		[2, 6, 8, 1],
	],
	// A safe and its dial.
	vault: [
		[0, 0, 12, 12],
		[1, 1, 10, 10, "cut"],
		[3, 3, 6, 6],
		[4, 4, 4, 4, "cut"],
		[5, 5, 2, 2],
	],
	// An arrow up out of a box.
	unloader: [
		[5, 0, 2, 1],
		[4, 1, 4, 1],
		[3, 2, 6, 1],
		[5, 3, 2, 3],
		[0, 6, 12, 6],
		[2, 8, 8, 2, "cut"],
	],
	// A furnace, its fire lit, and a chimney.
	kiln: [
		[2, 0, 2, 4],
		[0, 4, 12, 8],
		[3, 7, 6, 4, "cut"],
		[5, 8, 2, 3],
	],
	// A hopper over two rollers, grains falling out.
	pulverizer: [
		[0, 0, 12, 3],
		[2, 3, 8, 2],
		[1, 5, 4, 4],
		[7, 5, 4, 4],
		[2, 6, 2, 2, "cut"],
		[8, 6, 2, 2, "cut"],
		[3, 10, 2, 2],
		[7, 10, 2, 2],
	],
	// A flask.
	pyratiteMixer: [
		[4, 0, 4, 1],
		[5, 1, 2, 3],
		[3, 4, 6, 2],
		[1, 6, 10, 6],
		[3, 8, 6, 2, "cut"],
	],
	// A flame.
	combustionGenerator: [
		[5, 0, 2, 2],
		[4, 2, 4, 2],
		[3, 4, 6, 3],
		[2, 7, 8, 5],
		[4, 9, 4, 2, "cut"],
	],
	// A panel of cells on a stand.
	solarPanel: [
		[0, 0, 12, 10],
		[3, 0, 1, 10, "cut"],
		[8, 0, 1, 10, "cut"],
		[0, 4, 12, 1, "cut"],
		[5, 10, 2, 2],
	],
	// A radiation sign.
	rtgGenerator: [
		[0, 0, 12, 12],
		[1, 1, 10, 10, "cut"],
		[4, 2, 4, 2],
		[5, 5, 2, 2],
		[2, 7, 3, 3],
		[7, 7, 3, 3],
	],
	battery: [
		[4, 0, 4, 2],
		[2, 2, 8, 10],
		[3, 3, 6, 8, "cut"],
		[4, 7, 4, 3],
	],
	largeBattery: [
		[2, 0, 2, 2],
		[8, 0, 2, 2],
		[0, 2, 12, 10],
		[1, 3, 10, 8, "cut"],
		[2, 5, 8, 2],
		[2, 8, 8, 2],
	],
	// A pole, its crossbar and its tip.
	powerNode: [
		[4, 0, 4, 3],
		[5, 3, 2, 9],
		[2, 4, 8, 1],
		[3, 10, 6, 2],
	],
	// A lattice tower.
	largePowerNode: [
		[4, 0, 4, 2],
		[1, 2, 10, 1],
		[3, 3, 6, 8],
		[4, 4, 4, 6, "cut"],
		[5, 5, 2, 4],
		[0, 11, 12, 1],
	],
	crosshair: [
		[2, 2, 8, 1],
		[2, 9, 8, 1],
		[2, 2, 1, 8],
		[9, 2, 1, 8],
		[5, 5, 2, 2],
		[5, 0, 2, 4],
		[5, 8, 2, 4],
		[0, 5, 4, 2],
		[8, 5, 4, 2],
	],
	// A sign: a triangle with an exclamation mark cut out of it.
	warning: [
		[5, 0, 2, 2],
		[4, 2, 4, 2],
		[3, 4, 6, 2],
		[2, 6, 8, 2],
		[1, 8, 10, 2],
		[0, 10, 12, 2],
		[5, 3, 2, 4, "cut"],
		[5, 8, 2, 2, "cut"],
	],
};

interface GlyphProps {
	/** Fixed for the life of the component: swap glyphs by showing another one. */
	readonly glyph: GlyphId;
	readonly color: Color3 | (() => Color3);
	/** What `cut` rects are painted in: whatever the glyph sits on. */
	readonly background: Color3 | (() => Color3);
	readonly visible?: () => boolean;
}

/** A pixel-art icon filling its parent (keep the parent square). */
export function Glyph({ glyph, color, background, visible }: GlyphProps) {
	return (
		<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 1)} Visible={visible ?? true}>
			{GLYPHS[glyph].map(([x, y, w, h, cut], index) => (
				<frame
					BackgroundColor3={cut ? background : color}
					BorderSizePixel={0}
					Position={UDim2.fromScale(x / GRID, y / GRID)}
					Size={UDim2.fromScale(w / GRID, h / GRID)}
					ZIndex={index + 1}
				/>
			))}
		</frame>
	);
}
