import Vide from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Brackets, EnergyGradient, ScanSweep } from "core/Interface/client/components/hud";
import { Shadow } from "core/Interface/client/components/shadow";
import { useAppear, useScramble } from "core/Interface/client/motion";
import { CARD_TRANSPARENCY, COLORS, FONT, SPRINGS, type UiKind } from "core/Interface/client/theme";

/** The corner of a `Panel`. Children that fill a panel (like a card's hover gradient) use it to match. */
export const PANEL_CORNER = new UDim(0.01, 0);

interface PanelProps {
	readonly anchorPoint?: Vector2;
	readonly position?: UDim2;
	readonly size?: UDim2;
	/**
	 * 0-1: how raised the panel looks. Drive it from a hover spring: the shadow
	 * grows and glows, the outline warms and its energy speeds up, and the
	 * corner brackets open.
	 */
	readonly lift?: () => number;
	/** Sweeps a scan line down the panel again whenever this changes, as when its content swaps. */
	readonly rescan?: () => unknown;
	/** Which row of `EFFECTS` the panel takes its energy, brackets and scan from. */
	readonly kind?: UiKind;
	/** Sharp corners instead of the slight rounding. */
	readonly square?: boolean;
	readonly children?: Vide.Node;
}

/**
 * A dark translucent rounded panel with a drop shadow. Depending on its `kind`
 * in `EFFECTS`, energy runs round its outline, HUD brackets snap onto its
 * corners when it mounts, and a scan line sweeps down it as it opens. The base
 * of cards, dialogs and menu pages. Children go inside the panel body.
 */
export function Panel({
	anchorPoint,
	position,
	size,
	lift = () => 0,
	rescan,
	kind = "panel",
	square = false,
	children,
}: PanelProps) {
	// Starts the brackets far out, so they snap onto the corners as the panel opens.
	const [snap, snapSpring] = useSpring(1.8, SPRINGS.bouncy);
	snapSpring.setGoal(0);

	return (
		<frame
			Name="Panel"
			AnchorPoint={anchorPoint}
			BackgroundTransparency={1}
			Position={position}
			Size={size ?? UDim2.fromScale(1, 1)}
		>
			<Shadow lift={lift} glow={COLORS.accent} />
			<frame
				Name="Body"
				BackgroundColor3={COLORS.card}
				BackgroundTransparency={CARD_TRANSPARENCY}
				Size={UDim2.fromScale(1, 1)}
				ZIndex={1}
			>
				<uicorner CornerRadius={square ? new UDim() : PANEL_CORNER} />
				<uistroke
					Color={COLORS.text}
					LineJoinMode={square ? Enum.LineJoinMode.Miter : Enum.LineJoinMode.Round}
					StrokeSizingMode={Enum.StrokeSizingMode.ScaledSize}
					Thickness={0.005}
				>
					<EnergyGradient
						kind={kind}
						base={() => COLORS.stroke.Lerp(COLORS.accent, math.clamp(lift(), 0, 1) * 0.7)}
						charge={lift}
					/>
				</uistroke>
				{children}
			</frame>
			<ScanSweep kind={kind} trigger={rescan} />
			<Brackets kind={kind} open={() => math.max(lift(), snap())} />
		</frame>
	);
}

interface ModalProps {
	/** The message at the top of the dialog. */
	readonly text: string | (() => string);
	/**
	 * Turns false to play the exit animation. Return `$tuple(node, EXIT_TIME)`
	 * from the Show that renders the modal, so it stays mounted while it plays.
	 */
	readonly show?: () => boolean;
	/** What goes under the message, positioned in the lower 40% of the dialog: buttons or a spinner. */
	readonly children?: Vide.Node;
}

/** A dialog that pops in over a fading backdrop. Dims and blocks everything behind it, and fills its parent. */
export function Modal({ text, show, children }: ModalProps) {
	const appear = useAppear(show);
	const pop = useAppear(show, 0, SPRINGS.bouncy);

	return (
		<textbutton
			AutoButtonColor={false}
			BackgroundColor3={COLORS.card}
			BackgroundTransparency={() => 1 - 0.6 * appear()}
			Size={UDim2.fromScale(1, 1)}
			Text=""
			ZIndex={100}
		>
			{/* Larger than the dialog, so the canvas group fading it doesn't clip its shadow. */}
			<canvasgroup
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				GroupTransparency={() => 1 - appear()}
				Position={UDim2.fromScale(0.5, 0.5)}
				Size={UDim2.fromScale(0.48, 0.48)}
			>
				<uiaspectratioconstraint AspectRatio={2} />
				<uiscale Scale={() => 0.85 + 0.15 * pop()} />
				<Panel
					anchorPoint={new Vector2(0.5, 0.5)}
					position={UDim2.fromScale(0.5, 0.5)}
					size={UDim2.fromScale(0.84, 0.84)}
					kind="dialog"
				>
					<textlabel
						AnchorPoint={new Vector2(0.5, 0)}
						BackgroundTransparency={1}
						FontFace={FONT}
						Position={UDim2.fromScale(0.5, 0.06)}
						Size={UDim2.fromScale(0.88, 0.5)}
						Text={useScramble("dialog", typeIs(text, "string") ? () => text : text, 0, 0.3)}
						TextColor3={COLORS.text}
						TextScaled={true}
					>
						<uitextsizeconstraint MaxTextSize={40} />
					</textlabel>
					{children}
				</Panel>
			</canvasgroup>
		</textbutton>
	);
}
