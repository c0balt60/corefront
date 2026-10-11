import Vide from "@rbxts/vide";

import type { GlyphId } from "game/Research/shared/research";

/** A filled rectangle on a 12×12 grid: x, y, width, height. `cut` paints it in the background, to punch holes. */
type Rect = readonly [x: number, y: number, w: number, h: number, cut?: "cut"];

const GRID = 12;

/** A right-pointing chevron of 2×2 blocks, its back at column `x`. */
function chevron(x: number): Array<Rect> {
	return [
		[x, 1, 2, 2],
		[x + 2, 3, 2, 2],
		[x + 4, 5, 2, 2],
		[x + 2, 7, 2, 2],
		[x, 9, 2, 2],
	];
}

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
	pack: [
		[4, 0, 4, 1],
		[4, 0, 1, 2],
		[7, 0, 1, 2],
		[2, 2, 8, 9],
		[4, 5, 4, 1, "cut"],
		[3, 11, 2, 1],
		[7, 11, 2, 1],
	],
	boots: [...chevron(0), ...chevron(6)],
	bolt: [
		[6, 0, 4, 2],
		[5, 2, 4, 2],
		[4, 4, 4, 2],
		[2, 6, 8, 2],
		[5, 8, 3, 2],
		[4, 10, 2, 2],
	],
	coils: [
		[0, 1, 7, 2],
		[8, 1, 3, 2],
		[2, 5, 7, 2],
		[10, 5, 2, 2],
		[0, 9, 7, 2],
		[8, 9, 3, 2],
	],
	shield: [
		[2, 1, 8, 6],
		[3, 7, 6, 2],
		[4, 9, 4, 1],
		[5, 10, 2, 1],
		[5, 2, 2, 6, "cut"],
		[3, 4, 6, 2, "cut"],
	],
	silo: [
		[1, 1, 10, 3],
		[1, 5, 10, 3],
		[1, 9, 10, 3],
		[3, 2, 6, 1, "cut"],
		[3, 6, 6, 1, "cut"],
		[3, 10, 6, 1, "cut"],
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
