import Vide, { cleanup, effect, source } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Panel } from "core/Interface/client/components/panel";
import { useAppear, useScramble, useSpin } from "core/Interface/client/motion";
import { COLORS, FONT_DISPLAY, FONT_LABEL, SPRINGS } from "core/Interface/client/theme";

/** Slower than any `SPRINGS` preset, so the private code's glow swells and fades like a breath instead of blinking. */
const PULSE = { tension: 30, friction: 11 };
/** Seconds the glow takes to swell, and again to fade. */
const PULSE_SECONDS = 1.3;

interface WorldHeaderProps {
	readonly star: () => string;
	readonly code: () => string;
	readonly isPrivate: () => boolean;
	/** Turns false to lift it away. Return `$tuple(node, EXIT_TIME)` from the Show that renders it. */
	readonly show?: () => boolean;
}

/**
 * The world's star and its join code, top left, while the star map is up. A
 * private world is shared by code alone, so its code stands out: the header
 * glows with a slow pulse, the code grows and turns accent, and the status dot
 * blinks faster. A public one can be joined by code as well. The header drops
 * in from the top and lifts when hovered, scans once as it opens, and its star
 * and code decode.
 */
export function WorldHeader({ star, code, isPrivate, show }: WorldHeaderProps) {
	const drop = useAppear(show, 0.15);
	const hovered = source(false);
	const [hover, hoverSpring] = useSpring(0, SPRINGS.responsive);
	const [pulse, pulseSpring] = useSpring(0, PULSE);
	// 0-1: how far the private code has taken over the header.
	const [emphasis, emphasisSpring] = useSpring(isPrivate() ? 1 : 0, SPRINGS.smooth);
	const blink = useSpin(() => (isPrivate() ? 300 : 120));
	const name = useScramble("text", () => star().upper(), 0.2, 0.5);
	const join = useScramble("text", code, 0.3, 0.45);

	effect(() => hoverSpring.setGoal(hovered() ? 1 : 0));
	effect(() => emphasisSpring.setGoal(isPrivate() ? 1 : 0));
	effect(() => {
		if (!isPrivate()) {
			pulseSpring.setGoal(0);
			return;
		}

		cleanup(
			task.spawn(() => {
				while (true) {
					pulseSpring.setGoal(0.7);
					task.wait(PULSE_SECONDS);
					pulseSpring.setGoal(0.15);
					task.wait(PULSE_SECONDS);
				}
			}),
		);
	});

	const mix = () => math.clamp(emphasis(), 0, 1);

	return (
		<frame
			Name="WorldHeader"
			Active={true}
			BackgroundTransparency={1}
			Position={() => UDim2.fromScale(0.02, 0.03 - 0.2 * (1 - drop()))}
			Size={UDim2.fromScale(0.22, 0.11)}
			MouseEnter={() => hovered(true)}
			MouseLeave={() => hovered(false)}
		>
			<Panel lift={() => math.max(hover(), pulse())} rescan={star}>
				<uipadding
					PaddingBottom={new UDim(0.08, 0)}
					PaddingLeft={new UDim(0.06, 0)}
					PaddingRight={new UDim(0.06, 0)}
					PaddingTop={new UDim(0.08, 0)}
				/>
				<uilistlayout VerticalAlignment={Enum.VerticalAlignment.Center} />

				<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 0.2)}>
					<textlabel
						BackgroundTransparency={1}
						FontFace={FONT_LABEL}
						Size={UDim2.fromScale(0.5, 1)}
						Text="SECTOR"
						TextColor3={COLORS.subtext}
						TextScaled={true}
						TextXAlignment={Enum.TextXAlignment.Left}
					>
						<uitextsizeconstraint MaxTextSize={12} />
					</textlabel>
					{/* The status dot: green for a public world, accent for a private one, blinking faster. */}
					<frame
						AnchorPoint={new Vector2(1, 0.5)}
						BackgroundColor3={() => COLORS.confirm.Lerp(COLORS.accent, mix())}
						BackgroundTransparency={() => 1 - (0.3 + 0.35 * (1 + math.sin(math.rad(blink()))))}
						Position={UDim2.fromScale(1, 0.5)}
						Size={UDim2.fromScale(0.5, 0.4)}
					>
						<uiaspectratioconstraint DominantAxis={Enum.DominantAxis.Height} />
						<uicorner CornerRadius={new UDim(0.5, 0)} />
					</frame>
				</frame>
				<textlabel
					BackgroundTransparency={1}
					FontFace={FONT_DISPLAY}
					Size={UDim2.fromScale(1, 0.4)}
					Text={name}
					TextColor3={COLORS.text}
					TextScaled={true}
					TextXAlignment={Enum.TextXAlignment.Left}
				>
					<uitextsizeconstraint MaxTextSize={26} />
				</textlabel>
				<frame BackgroundTransparency={1} Size={() => UDim2.fromScale(1, 0.28 + 0.12 * mix())}>
					<textlabel
						BackgroundTransparency={1}
						FontFace={FONT_LABEL}
						Size={UDim2.fromScale(0.3, 1)}
						Text="JOIN CODE"
						TextColor3={COLORS.subtext}
						TextScaled={true}
						TextXAlignment={Enum.TextXAlignment.Left}
					>
						<uitextsizeconstraint MaxTextSize={14} />
					</textlabel>
					<textlabel
						BackgroundTransparency={1}
						FontFace={FONT_DISPLAY}
						Position={UDim2.fromScale(0.32, 0)}
						Size={UDim2.fromScale(0.68, 1)}
						Text={join}
						TextColor3={() => COLORS.muted.Lerp(COLORS.accent, mix())}
						TextScaled={true}
						TextXAlignment={Enum.TextXAlignment.Left}
					>
						<uitextsizeconstraint MaxTextSize={22} />
					</textlabel>
				</frame>
			</Panel>
		</frame>
	);
}
