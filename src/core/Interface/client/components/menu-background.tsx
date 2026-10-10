import { RunService, UserInputService, Workspace } from "@rbxts/services";
import Vide, { cleanup, source } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { ScanSweep } from "core/Interface/client/components/hud";
import { COLORS, hasEffect, IMAGES, SPRINGS } from "core/Interface/client/theme";

/** Grid cells across and down the screen. */
const COLUMNS = 16;
const ROWS = 9;
/** Cells the grid drifts per second, across and down. */
const DRIFT = new Vector2(0.04, 0.025);
/** Seconds between the scan lines that sweep down the backdrop. */
const SCAN_EVERY = 7;

/** Where each line of a grid with `cells` cells sits, as a fraction of a grid that spans two spare cells past each edge. */
function lineMarks(cells: number) {
	const marks = new Array<number>();
	for (let line = 0; line <= cells + 4; line++) marks.push(line / (cells + 4));
	return marks;
}

const COLUMN_MARKS = lineMarks(COLUMNS);
const ROW_MARKS = lineMarks(ROWS);

/**
 * The red low-poly backdrop of the loading screen and menus. It drifts against the mouse, eased by a spring, with a
 * faint grid sliding over it at a different depth, and a slow scan line sweeping down every few seconds.
 */
export function MenuBackground() {
	const [drift, driftSpring] = useSpring<Vector2>(Vector2.zero, SPRINGS.smooth);
	const now = source(0);

	cleanup(
		RunService.Heartbeat.Connect(() => {
			now(os.clock());

			const camera = Workspace.CurrentCamera;
			if (!camera) return;
			const fromCenter = camera.ViewportSize.div(2).sub(UserInputService.GetMouseLocation()).mul(0.1);
			driftSpring.setGoal(new Vector2(math.clamp(fromCenter.X, -120, 120), math.clamp(fromCenter.Y, -100, 100)));
		}),
	);

	return (
		<frame BackgroundColor3={COLORS.backdrop} ClipsDescendants={true} Size={UDim2.fromScale(1, 1)} ZIndex={0}>
			<imagelabel
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Image={IMAGES.background}
				ImageTransparency={0.5}
				Position={() => new UDim2(0.5, drift().X, 0.5, drift().Y)}
				ScaleType={Enum.ScaleType.Crop}
				Size={UDim2.fromScale(1.2, 1.2)}
			/>
			{/*
			 * Two spare cells past every edge, so the drift and the mouse parallax never show where it ends. It slides
			 * up to one cell and wraps, which looks the same since every line is alike.
			 */}
			<frame
				Name="Grid"
				Visible={hasEffect("background", "grid")}
				BackgroundTransparency={1}
				Position={() =>
					new UDim2(
						-(3 - ((now() * DRIFT.X) % 1)) / COLUMNS,
						drift().X * 0.5,
						-(3 - ((now() * DRIFT.Y) % 1)) / ROWS,
						drift().Y * 0.5,
					)
				}
				Size={UDim2.fromScale((COLUMNS + 4) / COLUMNS, (ROWS + 4) / ROWS)}
				ZIndex={1}
			>
				{COLUMN_MARKS.map((mark) => (
					<frame
						BackgroundColor3={COLORS.text}
						BackgroundTransparency={0.94}
						BorderSizePixel={0}
						Position={UDim2.fromScale(mark, 0)}
						Size={new UDim2(0, 1, 1, 0)}
					/>
				))}
				{ROW_MARKS.map((mark) => (
					<frame
						BackgroundColor3={COLORS.text}
						BackgroundTransparency={0.94}
						BorderSizePixel={0}
						Position={UDim2.fromScale(0, mark)}
						Size={new UDim2(1, 0, 0, 1)}
					/>
				))}
			</frame>
			<imagelabel
				BackgroundColor3={COLORS.card}
				BackgroundTransparency={0.4}
				Image={IMAGES.vignette}
				ImageTransparency={0.5}
				Size={UDim2.fromScale(1, 1)}
				ZIndex={2}
			/>
			<ScanSweep kind="background" every={SCAN_EVERY} duration={2.4} zIndex={3} />
		</frame>
	);
}
