import Vide, { cleanup, effect } from "@rbxts/vide";
import { useTween } from "@rbxts/vide-ripple";

import { useSpin } from "core/Interface/client/motion";
import { COLORS, hasEffect, type UiKind } from "core/Interface/client/theme";

/*
 * The sci-fi layer: energy running round outlines, corner brackets and scan
 * sweeps. Each takes the kind of UI it decorates, and only draws when that
 * kind lists it in `EFFECTS` (theme.ts).
 */

const clamp01 = (value: number) => math.clamp(value, 0, 1);

interface EnergyGradientProps {
	readonly kind: UiKind;
	/** The outline's resting colour. */
	readonly base: () => Color3;
	/** The colour of the energy. */
	readonly energy?: Color3;
	/** 0-1: speeds the energy up and widens it. Drive it from a hover spring. */
	readonly charge?: () => number;
}

/**
 * Energy running round an outline: two bright points that circle the border.
 * Put it inside a `uistroke` whose `Color` is white, since a gradient
 * multiplies the stroke's colour. Without `energy` for its kind, it holds the
 * outline at `base` and nothing moves.
 */
export function EnergyGradient({ kind, base, energy = COLORS.accent, charge = () => 0 }: EnergyGradientProps) {
	if (!hasEffect(kind, "energy")) return <uigradient Color={() => new ColorSequence(base())} />;

	const angle = useSpin(() => 50 + 250 * clamp01(charge()));

	return (
		<uigradient
			Color={() => {
				const rest = base();
				const width = 0.05 + 0.1 * clamp01(charge());
				return new ColorSequence([
					new ColorSequenceKeypoint(0, rest),
					new ColorSequenceKeypoint(0.5 - width, rest),
					new ColorSequenceKeypoint(0.5, energy),
					new ColorSequenceKeypoint(0.5 + width, rest),
					new ColorSequenceKeypoint(1, rest),
				]);
			}}
			Rotation={angle}
		/>
	);
}

const CORNERS = [new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1), new Vector2(1, 1)];

interface BracketsProps {
	readonly kind: UiKind;
	/** 0-1: how far the brackets stand off the corners, how long and how bright. Drive it from hover or appear. */
	readonly open: () => number;
	readonly color?: Color3;
	/** Arm length and thickness, in pixels, when fully open. */
	readonly length?: number;
	readonly thickness?: number;
	/** 0-1 opacity, for fading them out with their frame. */
	readonly visibility?: () => number;
	readonly zIndex?: number;
}

/**
 * HUD corner brackets round their parent, which they fill. Closed, they sit
 * dim on the corners. Opening pushes them outward and lights them. Put them
 * next to the frame they frame, like a `Shadow`.
 */
export function Brackets({
	kind,
	open,
	color = COLORS.accent,
	length = 14,
	thickness = 2,
	visibility = () => 1,
	zIndex = 3,
}: BracketsProps) {
	if (!hasEffect(kind, "brackets")) return [];

	const gap = () => 2 + 6 * open();
	const arm = () => length * (0.6 + 0.4 * clamp01(open()));
	const transparency = () => 1 - (0.35 + 0.65 * clamp01(open())) * visibility();

	return CORNERS.map((corner) => {
		const out = corner.mul(2).sub(Vector2.one);
		return (
			<frame
				AnchorPoint={corner}
				BackgroundTransparency={1}
				Position={() => new UDim2(corner.X, out.X * gap(), corner.Y, out.Y * gap())}
				Size={() => UDim2.fromOffset(arm(), arm())}
				ZIndex={zIndex}
			>
				<frame
					AnchorPoint={corner}
					BackgroundColor3={color}
					BackgroundTransparency={transparency}
					BorderSizePixel={0}
					Position={UDim2.fromScale(corner.X, corner.Y)}
					Size={new UDim2(1, 0, 0, thickness)}
				/>
				<frame
					AnchorPoint={corner}
					BackgroundColor3={color}
					BackgroundTransparency={transparency}
					BorderSizePixel={0}
					Position={UDim2.fromScale(corner.X, corner.Y)}
					Size={new UDim2(0, thickness, 1, 0)}
				/>
			</frame>
		);
	});
}

interface ScanSweepProps {
	readonly kind: UiKind;
	/** Sweeps again whenever this changes. It always sweeps once when it mounts. */
	readonly trigger?: () => unknown;
	/** Seconds between sweeps, to keep sweeping forever. */
	readonly every?: number;
	/** Seconds one sweep takes from top to bottom. */
	readonly duration?: number;
	readonly color?: Color3;
	readonly zIndex?: number;
}

/**
 * A scan line that sweeps down its parent, which it fills and clips to,
 * trailing a faint glow. Put it next to the frame it scans, like a `Shadow`.
 */
export function ScanSweep({
	kind,
	trigger = () => undefined,
	every,
	duration = 0.9,
	color = COLORS.accent,
	zIndex = 2,
}: ScanSweepProps) {
	if (!hasEffect(kind, "scan")) return [];

	const [progress, tween] = useTween(0, { duration, easing: "sineInOut" });
	tween.setGoal(1);

	effect(() => {
		trigger();
		tween.setPosition(0);
	});
	if (every !== undefined) {
		const loop = task.spawn(() => {
			while (true) {
				task.wait(every);
				tween.setPosition(0);
			}
		});
		cleanup(() => task.cancel(loop));
	}

	return (
		<frame BackgroundTransparency={1} ClipsDescendants={true} Size={UDim2.fromScale(1, 1)} ZIndex={zIndex}>
			{/* Its bottom edge travels from the top of the parent to past the bottom, so it starts and ends out of sight. */}
			<frame
				AnchorPoint={new Vector2(0, 1)}
				BackgroundColor3={color}
				BorderSizePixel={0}
				Position={() => UDim2.fromScale(0, progress() * 1.3)}
				Size={UDim2.fromScale(1, 0.3)}
			>
				<uigradient
					Rotation={90}
					Transparency={
						new NumberSequence([new NumberSequenceKeypoint(0, 1), new NumberSequenceKeypoint(1, 0.8)])
					}
				/>
				<frame
					AnchorPoint={new Vector2(0, 1)}
					BackgroundColor3={color}
					BorderSizePixel={0}
					Position={UDim2.fromScale(0, 1)}
					Size={new UDim2(1, 0, 0, 1)}
				>
					<uigradient
						Transparency={
							new NumberSequence([
								new NumberSequenceKeypoint(0, 1),
								new NumberSequenceKeypoint(0.5, 0.2),
								new NumberSequenceKeypoint(1, 1),
							])
						}
					/>
				</frame>
			</frame>
		</frame>
	);
}
