import Vide, { effect, source } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Brackets, EnergyGradient } from "core/Interface/client/components/hud";
import { Shadow } from "core/Interface/client/components/shadow";
import { useAppear, useScramble } from "core/Interface/client/motion";
import { COLORS, FONT, FONT_BOLD, FONT_DISPLAY, SPRINGS } from "core/Interface/client/theme";

/** Pixels a `Reveal` leaves around its content, so the canvas group that fades it doesn't clip shadows. */
const MARGIN = 64;

interface RevealProps {
	/** Turns false to play the exit. Return `$tuple(node, EXIT_TIME)` from the Show, Case or Index that renders it. */
	readonly show?: () => boolean;
	/** Seconds to wait before appearing, to stagger siblings. */
	readonly delay?: number;
	/** Pixels it rises from while appearing. */
	readonly distance?: number;
	/** The fraction of its size it grows from while appearing. 1 only fades and rises. */
	readonly scale?: number;
	readonly anchorPoint?: Vector2;
	readonly position?: UDim2;
	/** Fills its parent when left out. */
	readonly size?: UDim2;
	readonly layoutOrder?: number;
	readonly children?: Vide.Node;
}

/** Fades, rises and grows its children in when it mounts, and plays that backwards when `show` turns false. */
export function Reveal({
	show = () => true,
	delay,
	distance = 20,
	scale = 0.94,
	anchorPoint,
	position,
	size,
	layoutOrder,
	children,
}: RevealProps) {
	const appear = useAppear(show, delay);

	return (
		<frame
			Name="Reveal"
			AnchorPoint={anchorPoint}
			BackgroundTransparency={1}
			LayoutOrder={layoutOrder}
			Position={position}
			Size={size ?? UDim2.fromScale(1, 1)}
		>
			<canvasgroup
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				GroupTransparency={() => 1 - math.clamp(appear(), 0, 1)}
				Position={UDim2.fromScale(0.5, 0.5)}
				Size={new UDim2(1, MARGIN * 2, 1, MARGIN * 2)}
			>
				<frame
					AnchorPoint={new Vector2(0.5, 0.5)}
					BackgroundTransparency={1}
					Position={() => new UDim2(0.5, 0, 0.5, (1 - appear()) * distance)}
					Size={new UDim2(1, -MARGIN * 2, 1, -MARGIN * 2)}
				>
					<uiscale Scale={() => scale + (1 - scale) * appear()} />
					{children}
				</frame>
			</canvasgroup>
		</frame>
	);
}

interface PageHeadingProps {
	readonly title: string;
	readonly subtitle: string;
	readonly show?: () => boolean;
	readonly delay?: number;
}

/**
 * The big caps title and the grey line under it at the top left of a menu page. The title decodes as the page
 * opens, then an accent rule draws itself out under the subtitle and fades away along its length.
 */
export function PageHeading({ title, subtitle, show, delay = 0 }: PageHeadingProps) {
	const decoded = useScramble("text", () => title, delay + 0.1, 0.45);
	const rule = useAppear(show, delay + 0.2);

	return (
		<Reveal show={show} delay={delay} distance={12} scale={1}>
			{/* Wider than the word, so the title keeps its size while the letters decode. */}
			<textlabel
				BackgroundTransparency={1}
				FontFace={FONT_DISPLAY}
				Size={UDim2.fromScale(0.6, 0.11)}
				Text={decoded}
				TextColor3={COLORS.text}
				TextScaled={true}
				TextXAlignment={Enum.TextXAlignment.Left}
			/>
			<textlabel
				BackgroundTransparency={1}
				FontFace={FONT}
				Position={UDim2.fromScale(0, 0.115)}
				Size={UDim2.fromScale(0.6, 0.05)}
				Text={subtitle}
				TextColor3={COLORS.muted}
				TextScaled={true}
				TextXAlignment={Enum.TextXAlignment.Left}
			/>
			<frame
				Name="Rule"
				BackgroundColor3={COLORS.accent}
				BorderSizePixel={0}
				Position={UDim2.fromScale(0, 0.176)}
				Size={() => new UDim2(0.14 * math.clamp(rule(), 0, 1), 0, 0, 2)}
			>
				<uigradient
					Transparency={
						new NumberSequence([new NumberSequenceKeypoint(0, 0), new NumberSequenceKeypoint(1, 1)])
					}
				/>
			</frame>
		</Reveal>
	);
}

interface ReturnButtonProps {
	readonly onClick: () => void;
	readonly show?: () => boolean;
	readonly delay?: number;
}

/**
 * The square-cornered RETURN button at the bottom left of a menu page. Its label decodes as it arrives. Hovering
 * grows it, glows its shadow red and locks brackets onto its corners.
 */
export function ReturnButton({ onClick, show, delay = 0 }: ReturnButtonProps) {
	const hovered = source(false);
	const pressed = source(false);
	const label = useScramble("button", () => "RETURN", delay + 0.15, 0.35);

	const [lift, liftSpring] = useSpring<number>(0, SPRINGS.responsive);
	const [grow, growSpring] = useSpring<number>(1, SPRINGS.bouncy);
	const [clear, clearSpring] = useSpring<number>(0.3, SPRINGS.responsive);

	effect(() => {
		liftSpring.setGoal(hovered() && !pressed() ? 1 : 0);
		growSpring.setGoal(pressed() ? 0.95 : hovered() ? 1.04 : 1);
		clearSpring.setGoal(hovered() ? 0.1 : 0.3);
	});

	return (
		<Reveal
			show={show}
			delay={delay}
			anchorPoint={new Vector2(0, 1)}
			position={UDim2.fromScale(0, 1)}
			size={UDim2.fromScale(0.14, 0.08)}
		>
			<frame
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(0.5, 0.5)}
				Size={UDim2.fromScale(1, 1)}
			>
				<uiscale Scale={grow} />
				<Shadow lift={lift} glow={COLORS.danger} scale={0.6} />
				<textbutton
					AutoButtonColor={false}
					BackgroundColor3={COLORS.card}
					BackgroundTransparency={clear}
					FontFace={FONT_DISPLAY}
					Size={UDim2.fromScale(1, 1)}
					Text={label}
					TextColor3={COLORS.danger}
					TextScaled={true}
					ZIndex={1}
					MouseEnter={() => hovered(true)}
					MouseLeave={() => {
						hovered(false);
						pressed(false);
					}}
					MouseButton1Down={() => pressed(true)}
					MouseButton1Up={() => pressed(false)}
					Activated={onClick}
				>
					<uipadding PaddingBottom={new UDim(0.2, 0)} PaddingTop={new UDim(0.2, 0)} />
				</textbutton>
				<Brackets
					kind="button"
					open={lift}
					visibility={lift}
					length={8}
					thickness={1.5}
					color={COLORS.danger}
				/>
			</frame>
		</Reveal>
	);
}

interface TextFieldProps {
	readonly anchorPoint?: Vector2;
	readonly position: UDim2;
	readonly size: UDim2;
	/** Binds the text to this. Leave it out for a box the player fills in. */
	readonly text?: () => string;
	readonly placeholder?: string;
	/** Called as the text changes. Assign `box.Text` to correct what was typed. */
	readonly onChanged: (text: string, box: TextBox) => void;
	/** Called when the player stops typing. */
	readonly onFocusLost?: (box: TextBox) => void;
}

/**
 * A text box with energy running round its outline, which hovering speeds up and warms. While it has focus the
 * outline turns accent, the shadow glows and brackets lock onto its corners.
 */
export function TextField({ anchorPoint, position, size, text, placeholder, onChanged, onFocusLost }: TextFieldProps) {
	const focused = source(false);
	const hovered = source(false);
	const [glow, glowSpring] = useSpring<number>(0, SPRINGS.responsive);
	const [charge, chargeSpring] = useSpring<number>(0, SPRINGS.responsive);
	let box: TextBox | undefined;

	effect(() => {
		glowSpring.setGoal(focused() ? 1 : 0);
		chargeSpring.setGoal(focused() ? 1 : hovered() ? 0.6 : 0);
	});

	return (
		<frame Name="TextField" AnchorPoint={anchorPoint} BackgroundTransparency={1} Position={position} Size={size}>
			<Shadow lift={glow} glow={COLORS.accent} scale={0.6} visibility={glow} />
			<Brackets kind="field" open={glow} visibility={glow} length={10} thickness={1.5} />
			<textbox
				action={(rbx) => {
					box = rbx;
				}}
				BackgroundColor3={COLORS.card}
				BackgroundTransparency={0.3}
				FontFace={FONT_BOLD}
				PlaceholderColor3={COLORS.subtext}
				PlaceholderText={placeholder}
				Size={UDim2.fromScale(1, 1)}
				Text={text}
				TextColor3={COLORS.text}
				TextScaled={true}
				ZIndex={1}
				MouseEnter={() => hovered(true)}
				MouseLeave={() => hovered(false)}
				Focused={() => focused(true)}
				FocusLost={() => {
					focused(false);
					if (box) onFocusLost?.(box);
				}}
				TextChanged={(value) => {
					if (box) onChanged(value, box);
				}}
			>
				<uicorner CornerRadius={new UDim(0.15, 0)} />
				<uipadding PaddingBottom={new UDim(0.15, 0)} PaddingTop={new UDim(0.15, 0)} />
				<uistroke ApplyStrokeMode={Enum.ApplyStrokeMode.Border} Color={COLORS.text} Thickness={1.5}>
					<EnergyGradient
						kind="field"
						base={() => COLORS.stroke.Lerp(COLORS.accent, math.clamp(charge(), 0, 1))}
						charge={charge}
					/>
				</uistroke>
			</textbox>
		</frame>
	);
}
