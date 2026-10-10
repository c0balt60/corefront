import { RunService } from "@rbxts/services";
import Vide, { cleanup, derive, effect, source, untrack } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Brackets } from "core/Interface/client/components/hud";
import { MenuBackground } from "core/Interface/client/components/menu-background";
import { PulseDot } from "core/Interface/client/components/spinner";
import { useAppear, useScramble } from "core/Interface/client/motion";
import { COLORS, FONT, FONT_DISPLAY, FONT_LABEL, hasEffect, SPRINGS } from "core/Interface/client/theme";

const TIPS = [
	"Build defenses around your core before the aliens arrive.",
	"Gather resources early. Every upgrade starts with a drill.",
	"Conquer planets to unlock new resources and tougher worlds.",
	"Create a private world and share its join code with friends.",
	"Every seed grows its own star system. Share a seed to share the challenge.",
];
/** Seconds each tip stays up. */
const TIP_SECONDS = 4;

/** Marks on the ruler above the progress bar, as fractions of its length. */
const TICKS = 20;
const TICK_MARKS = new Array<number>();
for (let tick = 0; tick <= TICKS; tick++) TICK_MARKS.push(tick / TICKS);

/** A narrow band, slid along the filled part of the bar by a gradient offset from -1 to 1. */
const SHIMMER = new NumberSequence([
	new NumberSequenceKeypoint(0, 1),
	new NumberSequenceKeypoint(0.4, 1),
	new NumberSequenceKeypoint(0.5, 0.45),
	new NumberSequenceKeypoint(0.6, 1),
	new NumberSequenceKeypoint(1, 1),
]);

interface LoadingScreenProps {
	/** How much has loaded, from 0 to 1. */
	readonly progress: () => number;
	/** True once everything has loaded. Plays the exit animation. */
	readonly done: () => boolean;
	/** Called when the exit animation has finished. */
	readonly onFinished: () => void;
}

interface TipLabelProps {
	readonly text: () => string;
	readonly transparency: () => number;
	/** Decodes each tip as it appears, instead of showing it as it is. */
	readonly decode?: boolean;
}

/** A tip under the loading text. Two of them sit on top of each other to crossfade. */
function TipLabel({ text, transparency, decode = false }: TipLabelProps) {
	// Waits for the title and the loading text to settle before the first tip decodes.
	const shown = decode ? useScramble("loading", text, 1.2, 0.6) : text;

	return (
		<textlabel
			Name="Tip"
			AnchorPoint={new Vector2(0.5, 1)}
			BackgroundTransparency={1}
			FontFace={FONT}
			Position={UDim2.fromScale(0.5, 0.825)}
			Size={UDim2.fromScale(0.64, 0.075)}
			Text={shown}
			TextColor3={COLORS.subtext}
			TextScaled={true}
			TextTransparency={transparency}
		/>
	);
}

/**
 * The Corefront title screen: logo, tips and a progress bar. The title glitches in, with ghosted letters decoding
 * and brackets snapping onto it, the bar grows and follows the loading on a spring with a shimmer and a ruler that
 * lights up as it fills, the status line decodes and the tips decode as they crossfade. Over the backdrop's grid and
 * scan lines, it exits with a collapse, a zoom and a fade.
 */
export function LoadingScreen({ progress, done, onFinished }: LoadingScreenProps) {
	const startedAt = os.clock();
	const now = source(0);
	cleanup(RunService.Heartbeat.Connect(() => now(os.clock() - startedAt)));

	const dots = derive(() => math.floor(now() * 4) % 4);
	const tip = derive(() => TIPS[math.floor(now() / TIP_SECONDS) % TIPS.size()]);

	/** 1 while the title glitches: as it appears, easing out over a second, then a faint twitch every few seconds. */
	const glitch = () => {
		if (!hasEffect("loading", "glitch")) return 0;
		const seconds = now();
		const arrival = math.clamp(1 - (seconds - 0.15), 0, 1);
		const twitch = seconds > 3 && seconds % 7 < 0.2 ? 0.3 : 0;
		return math.max(arrival, twitch);
	};
	/** A random number from -1 to 1 that changes 24 times a second. Each channel gives its own. */
	const jitter = (channel: number) => math.noise(math.floor(now() * 24) + 0.37, channel + 0.71) * 2;

	const intro = useAppear(undefined, 0.15, SPRINGS.bouncy);
	const introFade = () => 1 - math.clamp(intro(), 0, 1);
	const [fill, fillSpring] = useSpring<number>(0, SPRINGS.smooth);
	const [barWidth, barSpring] = useSpring<number>(0, SPRINGS.smooth);
	const [exit, exitSpring] = useSpring<number>(0, SPRINGS.smooth);
	const [tipMix, tipSpring] = useSpring<number>(1, SPRINGS.smooth);

	// Two decodes of the same word, so while it settles the letters ghost against each other.
	const title = useScramble("loading", () => "COREFRONT", 0.15, 0.8);
	const titleGhost = useScramble("loading", () => "COREFRONT", 0.15, 0.8);
	const heading = useScramble("loading", () => (done() ? "SYSTEM READY" : "CONNECTING TO CORE"), 0.7, 0.5);
	// Derived, so progress ticking up doesn't decode it again: only the words changing does.
	const stageText = derive(() => (done() ? "ASSETS LOADED" : progress() > 0 ? "LOADING ASSETS" : "INITIALIZING"));
	const stage = useScramble("loading", stageText, 0.9, 0.5);

	effect(() => fillSpring.setGoal(math.clamp(progress(), 0, 1)));

	// A new tip fades in over the one it replaces, which fades out.
	const shownTip = source(tip());
	const lastTip = source(tip());
	effect(() => {
		const text = tip();
		if (text === untrack(shownTip)) return;
		lastTip(untrack(shownTip));
		shownTip(text);
		tipSpring.setPosition(0);
		tipSpring.setGoal(1);
	});

	effect(() => {
		if (!done()) {
			barSpring.setGoal(1);
			exitSpring.setGoal(0);
			return;
		}

		barSpring.setGoal(0);
		cleanup(
			task.spawn(() => {
				task.wait(0.6);
				exitSpring.setGoal(1);
				task.wait(0.8);
				// Deferred, so the screen is not torn down (and this thread cancelled) from inside this thread.
				task.defer(onFinished);
			}),
		);
	});

	return (
		<canvasgroup
			BackgroundTransparency={1}
			BorderSizePixel={0}
			GroupTransparency={exit}
			Size={UDim2.fromScale(1, 1)}
		>
			<MenuBackground />

			<frame
				Name="Logo"
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(0.5, 0.5)}
				Size={UDim2.fromScale(1, 1)}
				ZIndex={1}
			>
				<uiscale Scale={() => (0.8 + 0.2 * intro()) * (1 + 2 * exit())} />
				<frame
					Name="Line"
					AnchorPoint={new Vector2(0.5, 0.5)}
					BackgroundColor3={COLORS.accent}
					BackgroundTransparency={introFade}
					Position={UDim2.fromScale(0.5, 0.51)}
					Size={() => UDim2.fromScale(0.5 * math.clamp(intro(), 0, 1), 0.01)}
					ZIndex={1}
				>
					<uistroke
						Color={COLORS.stroke}
						StrokeSizingMode={Enum.StrokeSizingMode.ScaledSize}
						Thickness={0.55}
						Transparency={introFade}
					/>
					<uiaspectratioconstraint AspectRatio={94} />
				</frame>
				{/* The title's box is wider than the word, so its size stays put while the letters decode. */}
				<textlabel
					Name="TitleShadow"
					AnchorPoint={new Vector2(0.5, 0.5)}
					BackgroundTransparency={1}
					FontFace={FONT_DISPLAY}
					Position={() =>
						UDim2.fromScale(0.5026 + 0.01 * glitch() * jitter(1), 0.5046 + 0.003 * glitch() * jitter(2))
					}
					Size={UDim2.fromScale(0.5, 0.125)}
					Text={titleGhost}
					TextColor3={COLORS.accent}
					TextScaled={true}
					TextTransparency={introFade}
					ZIndex={2}
				>
					<uistroke
						Color={COLORS.stroke}
						StrokeSizingMode={Enum.StrokeSizingMode.ScaledSize}
						Thickness={0.07}
						Transparency={introFade}
					/>
				</textlabel>
				<textlabel
					Name="Title"
					AnchorPoint={new Vector2(0.5, 0.5)}
					BackgroundTransparency={1}
					FontFace={FONT_DISPLAY}
					Position={() => UDim2.fromScale(0.5 + 0.004 * glitch() * jitter(4), 0.5)}
					Size={UDim2.fromScale(0.5, 0.125)}
					Text={title}
					TextColor3={COLORS.text}
					TextScaled={true}
					// Drops out now and then while it glitches, never fully.
					TextTransparency={() => math.clamp(introFade() + (glitch() * jitter(3) > 0.2 ? 0.5 : 0), 0, 1)}
					ZIndex={3}
				/>
				{/* Locks onto the title as it arrives. */}
				<frame
					Name="TitleFrame"
					AnchorPoint={new Vector2(0.5, 0.5)}
					BackgroundTransparency={1}
					Position={UDim2.fromScale(0.5, 0.5)}
					Size={UDim2.fromScale(0.54, 0.2)}
					ZIndex={4}
				>
					<Brackets
						kind="loading"
						open={() => 0.2 + 1.6 * introFade()}
						visibility={() => 1 - introFade()}
						length={26}
						thickness={2}
						zIndex={4}
					/>
				</frame>
			</frame>

			<frame
				Name="Bottom"
				AnchorPoint={new Vector2(0.5, 1)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(0.5, 0.95)}
				Size={UDim2.fromScale(0.8, 0.3)}
				ZIndex={2}
			>
				<textlabel
					Name="Heading"
					AnchorPoint={new Vector2(0.5, 1)}
					BackgroundTransparency={1}
					FontFace={FONT_LABEL}
					Position={UDim2.fromScale(0.5, 0.7)}
					Size={UDim2.fromScale(0.5, 0.09)}
					Text={heading}
					TextColor3={COLORS.muted}
					TextScaled={true}
					TextTransparency={() => (done() ? 0 : 0.2 + 0.4 * (math.sin(now() * 2) * 0.5 + 0.5))}
				/>
				<TipLabel text={lastTip} transparency={tipMix} />
				<TipLabel text={shownTip} transparency={() => 1 - tipMix()} decode={true} />

				{/* A ruler over the bar. Each mark lights up as the bar fills past it. */}
				<frame
					Name="Ticks"
					AnchorPoint={new Vector2(0.5, 1)}
					BackgroundTransparency={1}
					Position={UDim2.fromScale(0.5, 0.855)}
					Size={() => UDim2.fromScale(0.6 * barWidth(), 0.02)}
				>
					{TICK_MARKS.map((mark, index) => (
						<frame
							AnchorPoint={new Vector2(0.5, 1)}
							BackgroundColor3={COLORS.text}
							BackgroundTransparency={() => (fill() >= mark ? 0.3 : 0.85)}
							BorderSizePixel={0}
							Position={UDim2.fromScale(mark, 1)}
							Size={new UDim2(0, 1, index % 5 === 0 ? 1 : 0.5, 0)}
						/>
					))}
				</frame>
				<canvasgroup
					Name="Bar"
					AnchorPoint={new Vector2(0.5, 0.5)}
					BackgroundColor3={COLORS.card}
					BackgroundTransparency={0.8}
					BorderSizePixel={0}
					Position={UDim2.fromScale(0.5, 0.875)}
					Size={() => UDim2.fromScale(0.6 * barWidth(), 0.03)}
				>
					<uistroke
						Color={COLORS.subtext}
						StrokeSizingMode={Enum.StrokeSizingMode.ScaledSize}
						Thickness={0.1}
						Transparency={0.5}
					/>
					<uicorner CornerRadius={new UDim(0.5, 0)} />
					<frame
						Name="Fill"
						BackgroundColor3={COLORS.text}
						BorderSizePixel={0}
						Size={() => UDim2.fromScale(fill(), 1)}
					>
						{/* An accent band that runs along the filled part, over and over. */}
						<frame BackgroundColor3={COLORS.accent} BorderSizePixel={0} Size={UDim2.fromScale(1, 1)}>
							<uigradient
								Offset={() => new Vector2(((now() * 0.8) % 1) * 2 - 1, 0)}
								Transparency={SHIMMER}
							/>
						</frame>
						{/* The leading edge. */}
						<frame
							AnchorPoint={new Vector2(1, 0.5)}
							BackgroundColor3={COLORS.accent}
							BorderSizePixel={0}
							Position={UDim2.fromScale(1, 0.5)}
							Size={new UDim2(0, 3, 1, 0)}
						/>
					</frame>
				</canvasgroup>

				{/* The status line sits under the bar's left end, the percentage under its right. */}
				<PulseDot
					anchorPoint={new Vector2(0.5, 0.5)}
					position={new UDim2(0.2, 5, 1 - 0.0425, 0)}
					color={() => (done() ? COLORS.confirm : COLORS.accent)}
				/>
				<textlabel
					Name="Status"
					AnchorPoint={new Vector2(0, 1)}
					BackgroundTransparency={1}
					FontFace={FONT_LABEL}
					Position={new UDim2(0.2, 16, 1, 0)}
					Size={UDim2.fromScale(0.3, 0.085)}
					Text={() => `${stage()}${done() ? "" : ".".rep(dots())}`}
					TextColor3={COLORS.subtext}
					TextScaled={true}
					TextXAlignment={Enum.TextXAlignment.Left}
				/>
				<textlabel
					Name="Percent"
					AnchorPoint={new Vector2(1, 1)}
					BackgroundTransparency={1}
					FontFace={FONT_DISPLAY}
					Position={UDim2.fromScale(0.8, 1)}
					Size={UDim2.fromScale(0.12, 0.085)}
					Text={() => `${math.floor(fill() * 100)}%`}
					TextColor3={COLORS.muted}
					TextScaled={true}
					TextXAlignment={Enum.TextXAlignment.Right}
				/>
			</frame>
		</canvasgroup>
	);
}
