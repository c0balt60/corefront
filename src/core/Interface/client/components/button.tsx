import Vide, { effect, source } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Brackets } from "core/Interface/client/components/hud";
import { Shadow } from "core/Interface/client/components/shadow";
import { useScramble } from "core/Interface/client/motion";
import { COLORS, FONT_DISPLAY, SPRINGS } from "core/Interface/client/theme";

interface ButtonProps {
	readonly text: string | (() => string);
	readonly color: Color3;
	readonly onClick: () => void;
	/** Greys the button out and ignores clicks while true. */
	readonly disabled?: () => boolean;
	readonly anchorPoint?: Vector2;
	readonly position?: UDim2;
	readonly size?: UDim2;
	readonly layoutOrder?: number;
}

/**
 * A solid square-cornered button (Create, Join, Back) with a shadow. Hovering
 * grows it, brightens it, locks brackets onto its corners and lifts its shadow
 * into a glow of its own colour. Pressing pushes it down. Disabling springs it
 * to grey. Its effects come from `EFFECTS.button`.
 */
export function Button(props: ButtonProps) {
	const { text, color, onClick, disabled = () => false } = props;
	const hovered = source(false);
	const pressed = source(false);
	const label = useScramble("button", typeIs(text, "string") ? () => text : text, 0, 0.35);

	const [lift, liftSpring] = useSpring(0, SPRINGS.responsive);
	const [scale, scaleSpring] = useSpring(1, SPRINGS.bouncy);
	const [fill, fillSpring] = useSpring(color, SPRINGS.responsive);

	effect(() => {
		const active = !disabled();
		liftSpring.setGoal(active && hovered() && !pressed() ? 1 : 0);
		scaleSpring.setGoal(!active ? 1 : pressed() ? 0.95 : hovered() ? 1.04 : 1);
		fillSpring.setGoal(!active ? COLORS.disabled : hovered() ? color.Lerp(COLORS.text, 0.12) : color);
	});

	return (
		<frame
			Name="Button"
			AnchorPoint={props.anchorPoint}
			BackgroundTransparency={1}
			LayoutOrder={props.layoutOrder}
			Position={props.position}
			Size={props.size ?? UDim2.fromScale(0.2, 0.08)}
		>
			{/* Scaled from a centred inner frame, so the button grows evenly whatever its AnchorPoint. */}
			<frame
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(0.5, 0.5)}
				Size={UDim2.fromScale(1, 1)}
			>
				<uiscale Scale={scale} />
				<Shadow lift={lift} glow={color} scale={0.6} visibility={() => (disabled() ? 0.4 : 1)} />
				<textbutton
					AutoButtonColor={false}
					BackgroundColor3={fill}
					FontFace={FONT_DISPLAY}
					Size={UDim2.fromScale(1, 1)}
					Text={label}
					TextColor3={() => (disabled() ? COLORS.subtext : COLORS.text)}
					TextScaled={true}
					ZIndex={1}
					MouseEnter={() => hovered(true)}
					MouseLeave={() => {
						hovered(false);
						pressed(false);
					}}
					MouseButton1Down={() => pressed(true)}
					MouseButton1Up={() => pressed(false)}
					Activated={() => {
						if (!disabled()) onClick();
					}}
				>
					<uipadding PaddingBottom={new UDim(0.24, 0)} PaddingTop={new UDim(0.24, 0)} />
				</textbutton>
				<Brackets kind="button" open={lift} visibility={lift} length={8} thickness={1.5} color={COLORS.text} />
			</frame>
		</frame>
	);
}
