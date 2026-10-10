import Vide, { effect, source } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Panel } from "core/Interface/client/components/panel";
import { useScramble } from "core/Interface/client/motion";
import { COLORS, FONT, FONT_DISPLAY, FONT_LABEL, SPRINGS } from "core/Interface/client/theme";
import { Reveal } from "lobby/Menu/client/components/page-parts";

interface MenuCardProps {
	readonly title: string;
	readonly subtitle: string;
	/** A short index shown in the card's top left corner, like "01". */
	readonly tag: string;
	/** The title's height as a fraction of the card's. Text is scaled, so small cards need taller titles. */
	readonly titleHeight: number;
	readonly onClick: () => void;
	readonly anchorPoint?: Vector2;
	readonly position?: UDim2;
	readonly size: UDim2;
	/** Turns false to play the exit. See `Reveal`. */
	readonly show?: () => boolean;
	/** Seconds before the card appears, to stagger a page's cards. */
	readonly delay?: number;
}

/** The bottom of the title and subtitle, as a fraction of the card's height. */
const BASELINE = 0.975;

/**
 * A big menu button that rises in, its title and index decoding as it lands. Hovering lifts the title to show the
 * subtitle, fades a warm gradient in, glows the shadow, swells the card, speeds up the energy on its outline,
 * opens its corner brackets, lights its index and sends a scan line down it. Pressing squishes it.
 */
export function MenuCard({
	title,
	subtitle,
	tag,
	titleHeight,
	onClick,
	anchorPoint,
	position,
	size,
	show,
	delay = 0,
}: MenuCardProps) {
	const hovered = source(false);
	const pressed = source(false);
	// Counts hovers, to scan the card each time the mouse comes onto it.
	const hovers = source(0);

	const [hover, hoverSpring] = useSpring<number>(0, SPRINGS.responsive);
	const [grow, growSpring] = useSpring<number>(1, SPRINGS.bouncy);
	const subtitleHeight = titleHeight * (2 / 3);
	const heading = useScramble("card", () => title, delay + 0.12, 0.4);
	const index = useScramble("card", () => tag, delay + 0.25, 0.3);

	effect(() => {
		hoverSpring.setGoal(hovered() ? 1 : 0);
		growSpring.setGoal(pressed() ? 0.97 : hovered() ? 1.025 : 1);
	});

	return (
		<Reveal show={show} delay={delay} anchorPoint={anchorPoint} position={position} size={size}>
			<frame
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(0.5, 0.5)}
				Size={UDim2.fromScale(1, 1)}
			>
				<uiscale Scale={grow} />
				<Panel kind="card" square={true} lift={hover} rescan={hovers}>
					<canvasgroup
						BackgroundColor3={COLORS.text}
						BorderSizePixel={0}
						GroupTransparency={() => 1 - hover()}
						Size={UDim2.fromScale(1, 1)}
					>
						<uigradient
							Color={
								new ColorSequence([
									new ColorSequenceKeypoint(0, COLORS.cardHover),
									new ColorSequenceKeypoint(0.5, COLORS.cardHover),
									new ColorSequenceKeypoint(1, COLORS.card),
								])
							}
							Rotation={-90}
							Transparency={
								new NumberSequence([
									new NumberSequenceKeypoint(0, 0.5),
									new NumberSequenceKeypoint(1, 1),
								])
							}
						/>
					</canvasgroup>
					<textlabel
						Name="Tag"
						BackgroundTransparency={1}
						FontFace={FONT_LABEL}
						Position={UDim2.fromScale(0.05, 0.05)}
						Size={UDim2.fromScale(0.2, 0.06)}
						Text={index}
						TextColor3={() => COLORS.subtext.Lerp(COLORS.accent, math.clamp(hover(), 0, 1))}
						TextScaled={true}
						TextXAlignment={Enum.TextXAlignment.Left}
						ZIndex={2}
					/>
					<textlabel
						Name="Title"
						AnchorPoint={new Vector2(0, 1)}
						BackgroundTransparency={1}
						FontFace={FONT_DISPLAY}
						Position={() => UDim2.fromScale(0.05, BASELINE - hover() * (subtitleHeight - 0.02))}
						Size={UDim2.fromScale(0.9, titleHeight)}
						Text={heading}
						TextColor3={COLORS.text}
						TextScaled={true}
						TextXAlignment={Enum.TextXAlignment.Left}
						ZIndex={2}
					/>
					<textlabel
						Name="Subtitle"
						AnchorPoint={new Vector2(0, 1)}
						BackgroundTransparency={1}
						FontFace={FONT}
						Position={UDim2.fromScale(0.05, BASELINE)}
						Size={UDim2.fromScale(0.9, subtitleHeight)}
						Text={subtitle}
						TextColor3={COLORS.subtext}
						TextScaled={true}
						TextTransparency={() => 1 - hover()}
						TextXAlignment={Enum.TextXAlignment.Left}
						ZIndex={2}
					/>
					<textbutton
						Name="Trigger"
						BackgroundTransparency={1}
						Size={UDim2.fromScale(1, 1)}
						Text=""
						ZIndex={3}
						MouseEnter={() => {
							hovered(true);
							hovers(hovers() + 1);
						}}
						MouseLeave={() => {
							hovered(false);
							pressed(false);
						}}
						MouseButton1Down={() => pressed(true)}
						MouseButton1Up={() => pressed(false)}
						Activated={onClick}
					/>
				</Panel>
			</frame>
		</Reveal>
	);
}
