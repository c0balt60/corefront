import Vide, { cleanup, source } from "@rbxts/vide";

import { useAppear, useScramble } from "core/Interface/client/motion";
import { COLORS, FONT, FONT_DISPLAY } from "core/Interface/client/theme";
import { HudBox, Label } from "game/Base/client/components/base-hud";

const EDGE = 16;
/** Clear of Roblox's top bar, which the tutorial's ScreenGui draws under. */
const TOP = 52;
const WIDTH = 280;
/** `HudBox`'s padding, down. */
const PAD = 18;
/** Seconds a click on SKIP waits for a second one. */
const CONFIRM_SECONDS = 3;

interface TutorialPanelProps {
	/** The step's index, from 0, and how many steps there are. */
	readonly step: () => number;
	readonly steps: number;
	readonly title: () => string;
	readonly text: () => string;
	/** A line of how far along the player is, if there's one to show. */
	readonly progress: () => string | undefined;
	/** Called on the second click of SKIP. */
	readonly onSkip: () => void;
	/** Turns false to slide it out. Return `$tuple(node, EXIT_TIME)` from the Show that renders it. */
	readonly show: () => boolean;
}

/**
 * The objective card, top right above the wave panel: which step it is, what to do and, under it, how far
 * along the player is. SKIP wants a second click within `CONFIRM_SECONDS`, so it can't be hit by accident.
 */
export function TutorialPanel({ step, steps, title, text, progress, onSkip, show }: TutorialPanelProps) {
	const slide = useAppear(show);
	const confirming = source(false);
	let timer: thread | undefined;
	cleanup(() => timer && task.cancel(timer));

	// The text wraps to any number of lines, so the box follows its content.
	const content = source(0);
	const measure = (frame: Frame) => {
		const update = () => content(frame.AbsoluteSize.Y);
		update();
		cleanup(frame.GetPropertyChangedSignal("AbsoluteSize").Connect(update));
	};

	return (
		<HudBox
			name="TutorialPanel"
			anchorPoint={new Vector2(1, 0)}
			position={() => new UDim2(1, -EDGE + (WIDTH + 2 * EDGE) * (1 - slide()), 0, TOP)}
			size={() => UDim2.fromOffset(WIDTH, content() + PAD)}
		>
			<frame
				action={measure}
				AutomaticSize={Enum.AutomaticSize.Y}
				BackgroundTransparency={1}
				Size={new UDim2(1, 0, 0, 0)}
			>
				<uilistlayout Padding={new UDim(0, 2)} SortOrder={Enum.SortOrder.LayoutOrder} />
				<frame BackgroundTransparency={1} LayoutOrder={0} Size={new UDim2(1, 0, 0, 14)}>
					<Label
						size={new UDim2(1, -60, 1, 0)}
						text={useScramble("hud", () => `TUTORIAL · ${step() + 1}/${steps}`, 0.1)}
					/>
					<textbutton
						AnchorPoint={new Vector2(1, 0)}
						BackgroundTransparency={1}
						FontFace={FONT_DISPLAY}
						Position={UDim2.fromScale(1, 0)}
						Size={UDim2.fromOffset(120, 14)}
						Text={() => (confirming() ? "SURE? CLICK AGAIN" : "SKIP")}
						TextColor3={() => (confirming() ? COLORS.danger : COLORS.subtext)}
						TextSize={11}
						TextXAlignment={Enum.TextXAlignment.Right}
						Activated={() => {
							if (confirming()) return onSkip();
							confirming(true);
							timer = task.delay(CONFIRM_SECONDS, () => confirming(false));
						}}
					/>
				</frame>
				<Label
					color={COLORS.text}
					font={FONT_DISPLAY}
					layoutOrder={1}
					size={new UDim2(1, 0, 0, 22)}
					text={useScramble("hud", title, 0.15, 0.3)}
					textSize={16}
				/>
				<textlabel
					AutomaticSize={Enum.AutomaticSize.Y}
					BackgroundTransparency={1}
					FontFace={FONT}
					LayoutOrder={2}
					Size={new UDim2(1, 0, 0, 0)}
					Text={text}
					TextColor3={COLORS.muted}
					TextSize={14}
					TextWrapped={true}
					TextXAlignment={Enum.TextXAlignment.Left}
				/>
				<Label
					color={COLORS.accent}
					font={FONT_DISPLAY}
					layoutOrder={3}
					size={new UDim2(1, 0, 0, 16)}
					text={() => progress() ?? ""}
					textSize={12}
				/>
			</frame>
		</HudBox>
	);
}
