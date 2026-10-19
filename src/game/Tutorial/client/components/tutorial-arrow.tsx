import { RunService, Workspace } from "@rbxts/services";
import Vide, { cleanup, source } from "@rbxts/vide";

import { COLORS } from "core/Interface/client/theme";

/** The arrow's height in pixels (it is square), and how far its tip stands off its target and the screen's edge. */
const LENGTH = 48;
const GAP = 8;
const MARGIN = 56;
/** How far it bobs, in pixels. */
const BOB = 6;

interface TutorialArrowProps {
	/** What to point at: a part of the interface, or a thing in the world. The interface wins. */
	readonly gui: () => GuiObject | undefined;
	readonly world: () => PVInstance | undefined;
	/** Turns false to hide it. */
	readonly show: () => boolean;
}

/**
 * A bobbing arrow that points at a target. At a GUI object it stands above it, or under it near the top of
 * the screen. At a world object it stands over it. Off screen or behind the camera, it sits at the screen's
 * edge and turns towards the target; a GUI object scrolled out of view gets the same at the edge of what clips it. It follows its target every frame, so put it in a ScreenGui that
 * ignores the inset: it works in pixels from the screen's top left.
 */
export function TutorialArrow({ gui, world, show }: TutorialArrowProps) {
	const position = source(UDim2.fromOffset(0, 0));
	const rotation = source(0);
	const visible = source(false);
	const camera = Workspace.CurrentCamera!;
	// Where this ScreenGui's top left is among absolute positions, which some ScreenGuis count from under the inset.
	const origin = (<frame BackgroundTransparency={1} Size={new UDim2()} />) as Frame;

	/** Puts the tip on `tip`, pointing along `direction`. Pointing down is 0 degrees, and it turns clockwise. */
	const place = (tip: Vector2, direction: Vector2) => {
		const centre = tip.sub(direction.mul(LENGTH / 2));
		position(UDim2.fromOffset(centre.X, centre.Y));
		rotation(math.deg(math.atan2(-direction.X, direction.Y)));
		visible(true);
	};

	cleanup(
		RunService.RenderStepped.Connect(() => {
			const element = gui();
			const object = world();
			const screen = camera.ViewportSize;
			const bob = math.sin(os.clock() * 6) * BOB;
			visible(false);
			if (!show()) return;

			// Where it aims, how far its target reaches above and below that, and whether the camera has it at its back.
			let point: Vector2;
			let reach = 0;
			let behind = false;
			// The part of the screen the target can show in, and whether it's in it: the screen, or for an interface
			// target, what of it the frames that clip it leave.
			let low = Vector2.zero;
			let high = screen;
			let onScreen = false;
			if (element && element.AbsoluteSize.X > 0) {
				const shift = origin.AbsolutePosition.mul(-1);
				point = element.AbsolutePosition.add(element.AbsoluteSize.div(2)).add(shift);
				reach = element.AbsoluteSize.Y / 2;
				let parent = element.Parent;
				while (parent?.IsA("GuiObject")) {
					if (parent.ClipsDescendants) {
						low = low.Max(parent.AbsolutePosition.add(shift));
						high = high.Min(parent.AbsolutePosition.add(parent.AbsoluteSize).add(shift));
					}
					parent = parent.Parent;
				}
				// Scrolled out of view, it's pointed at from the edge, so the player knows which way to scroll.
				onScreen = point.X >= low.X && point.X <= high.X && point.Y >= low.Y && point.Y <= high.Y;
			} else if (object) {
				const [cframe, size] = object.IsA("Model")
					? object.GetBoundingBox()
					: [(object as BasePart).CFrame, (object as BasePart).Size];
				const [projected] = camera.WorldToViewportPoint(cframe.Position.add(new Vector3(0, size.Y / 2, 0)));
				behind = projected.Z < 0;
				// Behind the camera it lands mirrored through the middle of the screen.
				point = behind
					? screen.sub(new Vector2(projected.X, projected.Y))
					: new Vector2(projected.X, projected.Y);
			} else {
				return;
			}

			// An interface target in view needs no margin: the topbar's buttons sit nearer the edge than it.
			const inside =
				onScreen ||
				(!element &&
					!behind &&
					point.X > MARGIN &&
					point.X < screen.X - MARGIN &&
					point.Y > MARGIN &&
					point.Y < screen.Y - MARGIN);
			if (inside) {
				// Over the target, or under it where there is no room above.
				const above = point.Y - reach - GAP - LENGTH > MARGIN / 2;
				const tip = point.add(new Vector2(0, above ? -(reach + GAP + bob) : reach + GAP + bob));
				place(tip, new Vector2(0, above ? 1 : -1));
				return;
			}

			const middle = low.add(high).div(2);
			const half = high.sub(low).div(2);
			const offset = point.sub(middle);
			if (offset.Magnitude < 1) return;
			const direction = offset.Unit;
			// How far along its direction it gets before touching the margin.
			const edge = math.max(
				math.min(
					(half.X - MARGIN) / math.max(math.abs(direction.X), 1e-3),
					(half.Y - MARGIN) / math.max(math.abs(direction.Y), 1e-3),
				),
				0,
			);
			place(middle.add(direction.mul(edge + bob)), direction);
		}),
	);

	return [
		origin,
		<imagelabel
			Name="TutorialArrow"
			AnchorPoint={new Vector2(0.5, 0.5)}
			BackgroundTransparency={1}
			Image="rbxassetid://7640051440"
			ImageColor3={COLORS.accent}
			Position={position}
			Rotation={rotation}
			Size={UDim2.fromOffset(LENGTH, LENGTH)}
			Visible={visible}
		/>,
	];
}
