import Vide, { derive, effect, Show, source } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Button } from "core/Interface/client/components/button";
import { EnergyGradient } from "core/Interface/client/components/hud";
import { Modal, Panel } from "core/Interface/client/components/panel";
import { Shadow } from "core/Interface/client/components/shadow";
import { EXIT_TIME, useAppear, useScramble } from "core/Interface/client/motion";
import { COLORS, FONT, FONT_DISPLAY, FONT_LABEL, LEVEL_COLORS, SPRINGS } from "core/Interface/client/theme";
import {
	generateStarSystem,
	LEVEL_NAMES,
	MAX_PLANETS,
	MIN_PLANETS,
	PLANET_KINDS,
	type PlanetKind,
	type StarSettings,
	summarizeStarSystem,
} from "core/Worlds/shared/star-system";
import { isValidSeed, randomSeed } from "core/Worlds/shared/worlds";
import { PageHeading, ReturnButton, Reveal, TextField } from "lobby/Menu/client/components/page-parts";

/** Most digits a seed has, so typing stops being accepted past it. */
const SEED_DIGITS = 10;
const MAX_LEVEL = LEVEL_NAMES.size() - 1;

interface CreatePageProps {
	/** The empty save slot the world goes in, from 1. */
	readonly slot: number;
	/** Called once the player has confirmed. A `sandbox` is one planet of that kind, everything unlocked. */
	readonly onCreate: (settings: StarSettings, isPrivate: boolean) => void;
	readonly onReturn: () => void;
	/** Turns false while the page is leaving, so its parts play their exit. */
	readonly show?: () => boolean;
}

/**
 * Pick a seed and privacy for a new world, or a sandbox and its planet kind, see the star system the seed makes,
 * tune its planet count, difficulty, aliens and resources, then confirm to create it.
 * Its parts rise in one after another, their labels decoding as they land. When RANDOM picks a seed it rolls to
 * the new number, a scan line sweeps the panel and the system info decodes to the new star. A stepped stat stays
 * as set through new seeds.
 */
export function CreatePage({ slot, onCreate, onReturn, show }: CreatePageProps) {
	const seed = source(randomSeed());
	const isPrivate = source(false);
	const sandbox = source(false);
	const kind = source<PlanetKind>("Habitable");
	const confirming = source(false);
	// Undefined until stepped: the seed rolls them.
	const planets = source<number | undefined>(undefined);
	const difficulty = source<number | undefined>(undefined);
	const aliens = source<number | undefined>(undefined);
	const resources = source<number | undefined>(undefined);

	// A sandbox is one planet with waves on demand, so only its seed and kind count.
	const settings = derive((): StarSettings =>
		sandbox()
			? { seed: seed(), sandbox: kind() }
			: {
					seed: seed(),
					planets: planets(),
					difficulty: difficulty(),
					aliens: aliens(),
					resources: resources(),
				},
	);
	const system = derive(() => generateStarSystem(settings()));
	const summary = derive(() => summarizeStarSystem(system(), settings()));
	/** Steps a stat from what it shows now, within its range. */
	const stepper =
		(stat: (value: number) => void, shown: () => number, max: number, min = 0) =>
		(delta: number) =>
			stat(math.clamp(shown() + delta, min, max));

	// The seed on screen chases the real one, so a new seed rolls up or down to its value.
	const [rolling, rollSpring] = useSpring<number>(seed(), SPRINGS.smooth);
	effect(() => rollSpring.setGoal(seed()));

	return (
		<frame Name="CreatePage" BackgroundTransparency={1} Size={UDim2.fromScale(1, 1)}>
			<PageHeading title="CREATE" subtitle={`Create a new world in slot ${slot}`} show={show} />

			<Reveal
				show={show}
				delay={0.06}
				scale={0.97}
				position={UDim2.fromScale(0, 0.2)}
				size={UDim2.fromScale(1, 0.62)}
			>
				<Panel rescan={seed}>
					<frame
						BackgroundTransparency={1}
						Position={UDim2.fromScale(0.03, 0.06)}
						Size={UDim2.fromScale(0.94, 0.88)}
					>
						{/* Each group fills the frame and holds its controls at their own positions, so they rise in turn. */}
						<Reveal show={show} delay={0.14} scale={1}>
							<Caption text="SEED" position={UDim2.fromScale(0, 0)} delay={0.24} />
							<TextField
								position={UDim2.fromScale(0, 0.11)}
								size={UDim2.fromScale(0.27, 0.18)}
								text={() => tostring(math.round(rolling()))}
								onChanged={(text, box) => {
									// Digits only. Anything else typed is dropped as it arrives.
									const digits = text.gsub("%D", "")[0].sub(1, SEED_DIGITS);
									if (digits !== text) box.Text = digits;
								}}
								onFocusLost={(box) => {
									const typed = tonumber(box.Text);
									if (isValidSeed(typed)) {
										seed(typed);
										// A typed seed lands at once. Only RANDOM rolls.
										rollSpring.setPosition(typed);
										rollSpring.halt();
									}
									// Shows the accepted seed, or puts the old one back when the typed one was not valid.
									box.Text = tostring(seed());
								}}
							/>
							<Button
								text="RANDOM"
								color={COLORS.stroke}
								onClick={() => seed(randomSeed())}
								position={UDim2.fromScale(0.29, 0.11)}
								size={UDim2.fromScale(0.17, 0.18)}
							/>
						</Reveal>

						<Reveal show={show} delay={0.2} scale={1}>
							<Caption text="PRIVATE WORLD" position={UDim2.fromScale(0, 0.36)} delay={0.3} />
							<Toggle
								on={isPrivate}
								onToggle={() => isPrivate(!isPrivate())}
								position={UDim2.fromScale(0, 0.47)}
							/>
							<Hint text="Only players with your join code can join." shown={isPrivate} />
						</Reveal>

						<Reveal show={show} delay={0.26} scale={1}>
							<Caption text="SANDBOX WORLD" position={UDim2.fromScale(0, 0.7)} delay={0.36} />
							<Toggle
								on={sandbox}
								onToggle={() => sandbox(!sandbox())}
								position={UDim2.fromScale(0, 0.81)}
							/>
							<Show when={sandbox}>
								{() => (
									// Cycles through the kinds of planet.
									<Button
										text={() => kind().upper()}
										color={COLORS.stroke}
										onClick={() =>
											kind(PLANET_KINDS[(PLANET_KINDS.indexOf(kind()) + 1) % PLANET_KINDS.size()])
										}
										position={UDim2.fromScale(0.12, 0.81)}
										size={UDim2.fromScale(0.22, 0.16)}
									/>
								)}
							</Show>
						</Reveal>

						<Reveal show={show} delay={0.14} scale={1}>
							<Caption text="SYSTEM INFO" position={UDim2.fromScale(0.54, 0)} delay={0.24} />
							{/* A divider between the controls and the readout, fading out at both ends. */}
							<frame
								BackgroundColor3={COLORS.stroke}
								BorderSizePixel={0}
								Position={UDim2.fromScale(0.5, 0.02)}
								Size={new UDim2(0, 1, 0.96, 0)}
							>
								<uigradient
									Rotation={90}
									Transparency={
										new NumberSequence([
											new NumberSequenceKeypoint(0, 1),
											new NumberSequenceKeypoint(0.5, 0),
											new NumberSequenceKeypoint(1, 1),
										])
									}
								/>
							</frame>
						</Reveal>
						<frame
							BackgroundTransparency={1}
							Position={UDim2.fromScale(0.54, 0.12)}
							Size={UDim2.fromScale(0.46, 0.8)}
						>
							<uilistlayout Padding={new UDim(0.025, 0)} SortOrder={Enum.SortOrder.LayoutOrder} />
							<Stat order={1} name="Star" value={() => system().star} show={show} />
							<Stat
								order={2}
								name="Planets"
								value={() => tostring(summary().planets)}
								onStep={stepper(planets, () => summary().planets, MAX_PLANETS, MIN_PLANETS)}
								locked={sandbox}
								show={show}
							/>
							<Stat
								order={3}
								name="Difficulty"
								value={() => (sandbox() ? "Sandbox" : LEVEL_NAMES[summary().difficulty])}
								color={() => (sandbox() ? COLORS.accent : LEVEL_COLORS[summary().difficulty])}
								onStep={stepper(difficulty, () => summary().difficulty, MAX_LEVEL)}
								locked={sandbox}
								show={show}
							/>
							<Stat
								order={4}
								name="Alien density"
								value={() => (sandbox() ? "On demand" : LEVEL_NAMES[summary().aliens])}
								color={() => (sandbox() ? COLORS.accent : LEVEL_COLORS[summary().aliens])}
								onStep={stepper(aliens, () => summary().aliens, MAX_LEVEL)}
								locked={sandbox}
								show={show}
							/>
							<Stat
								order={5}
								name="Resources"
								value={() => LEVEL_NAMES[summary().resources]}
								onStep={stepper(resources, () => summary().resources, MAX_LEVEL)}
								locked={sandbox}
								show={show}
							/>
						</frame>
					</frame>
				</Panel>
			</Reveal>

			<ReturnButton onClick={onReturn} show={show} delay={0.3} />
			<Reveal
				show={show}
				delay={0.36}
				anchorPoint={new Vector2(1, 1)}
				position={UDim2.fromScale(1, 1)}
				size={UDim2.fromScale(0.2, 0.08)}
			>
				<Button
					text="CREATE"
					color={COLORS.confirm}
					onClick={() => confirming(true)}
					anchorPoint={new Vector2(0.5, 0.5)}
					position={UDim2.fromScale(0.5, 0.5)}
					size={UDim2.fromScale(1, 1)}
				/>
			</Reveal>

			<Show when={confirming}>
				{(_, visible) =>
					$tuple(
						<Modal show={visible} text="Are you sure you want to create this world?">
							<Button
								text="BACK"
								color={COLORS.danger}
								onClick={() => confirming(false)}
								position={UDim2.fromScale(0.08, 0.68)}
								size={UDim2.fromScale(0.38, 0.2)}
							/>
							<Button
								text="CREATE"
								color={COLORS.confirm}
								onClick={() => {
									confirming(false);
									onCreate(settings(), isPrivate());
								}}
								position={UDim2.fromScale(0.54, 0.68)}
								size={UDim2.fromScale(0.38, 0.2)}
							/>
						</Modal>,
						EXIT_TIME,
					)
				}
			</Show>
		</frame>
	);
}

interface CaptionProps {
	readonly text: string;
	readonly position: UDim2;
	/** Seconds before it starts decoding, to land after the group it belongs to rises. */
	readonly delay: number;
}

/** A small grey caps label over a group of controls. It decodes as the group arrives. */
function Caption({ text, position, delay }: CaptionProps) {
	const decoded = useScramble("text", () => text, delay, 0.4);

	return (
		<textlabel
			BackgroundTransparency={1}
			FontFace={FONT_LABEL}
			Position={position}
			Size={UDim2.fromScale(0.46, 0.09)}
			Text={decoded}
			TextColor3={COLORS.muted}
			TextScaled={true}
			TextXAlignment={Enum.TextXAlignment.Left}
		/>
	);
}

/** The line under the private toggle. It slides in and fades while the toggle is on. */
function Hint({ text, shown }: { readonly text: string; readonly shown: () => boolean }) {
	const appear = useAppear(shown);

	return (
		<textlabel
			BackgroundTransparency={1}
			FontFace={FONT}
			Position={() => new UDim2(0.12, (appear() - 1) * 14, 0.47, 0)}
			Size={UDim2.fromScale(0.34, 0.16)}
			Text={text}
			TextColor3={COLORS.muted}
			TextScaled={true}
			TextTransparency={() => 1 - math.clamp(appear(), 0, 1)}
			TextXAlignment={Enum.TextXAlignment.Left}
		/>
	);
}

interface StatProps {
	readonly order: number;
	readonly name: string;
	readonly value: () => string;
	readonly color?: () => Color3;
	/** Puts arrows either side of the value, which call this with -1 or 1. */
	readonly onStep?: (delta: number) => void;
	/** Greys the arrows out while true. */
	readonly locked?: () => boolean;
	readonly show?: () => boolean;
}

/**
 * One line of the system info: a grey name and its value, both decoding as the row rises. Whenever the value
 * changes it decodes again, pops and changes colour. A stat that can be set has arrows either side of its value.
 */
function Stat({ order, name, value, color = () => COLORS.text, onStep, locked, show }: StatProps) {
	const [pop, popSpring] = useSpring<number>(1, SPRINGS.bouncy);
	const [tint, tintSpring] = useSpring<Color3>(color(), SPRINGS.responsive);
	const delay = 0.2 + order * 0.06;
	const label = useScramble("text", () => name.upper(), delay + 0.1, 0.35);
	// Derived, so only a different value decodes again. The same one handed over again doesn't.
	const text = derive(() => value().upper());
	const decoded = useScramble("text", text, delay + 0.2, 0.4);
	// Pops on every change after the first.
	effect((last: string | undefined) => {
		const current = value();
		if (last !== undefined && current !== last) popSpring.impulse(2.5);
		return current;
	}, undefined);
	effect(() => tintSpring.setGoal(color()));

	return (
		<Reveal show={show} delay={delay} distance={12} scale={1} layoutOrder={order} size={UDim2.fromScale(1, 0.14)}>
			<textlabel
				BackgroundTransparency={1}
				FontFace={FONT_LABEL}
				Size={UDim2.fromScale(0.45, 1)}
				Text={label}
				TextColor3={COLORS.muted}
				TextScaled={true}
				TextXAlignment={Enum.TextXAlignment.Left}
			/>
			<textlabel
				AnchorPoint={new Vector2(0, 0.5)}
				BackgroundTransparency={1}
				FontFace={FONT_DISPLAY}
				Position={UDim2.fromScale(onStep ? 0.57 : 0.5, 0.5)}
				Size={UDim2.fromScale(onStep ? 0.33 : 0.5, 1)}
				Text={decoded}
				TextColor3={tint}
				TextScaled={true}
				TextXAlignment={onStep ? Enum.TextXAlignment.Center : Enum.TextXAlignment.Left}
			>
				<uiscale Scale={pop} />
			</textlabel>
			{onStep && (
				<>
					<Button
						text="<"
						color={COLORS.stroke}
						disabled={locked}
						onClick={() => onStep(-1)}
						position={UDim2.fromScale(0.47, 0.05)}
						size={UDim2.fromScale(0.09, 0.9)}
					/>
					<Button
						text=">"
						color={COLORS.stroke}
						disabled={locked}
						onClick={() => onStep(1)}
						position={UDim2.fromScale(0.91, 0.05)}
						size={UDim2.fromScale(0.09, 0.9)}
					/>
				</>
			)}
		</Reveal>
	);
}

interface ToggleProps {
	readonly on: () => boolean;
	readonly onToggle: () => void;
	readonly position: UDim2;
}

/**
 * A pill switch. The knob springs across with a bounce, riding on its own shadow, and the pill turns green. Energy
 * runs round the pill's outline, faster on hover and a little quicker while it is on.
 */
function Toggle({ on, onToggle, position }: ToggleProps) {
	const hovered = source(false);
	const [slide, slideSpring] = useSpring<number>(on() ? 1 : 0, SPRINGS.bouncy);
	const [lift, liftSpring] = useSpring<number>(0, SPRINGS.responsive);

	effect(() => slideSpring.setGoal(on() ? 1 : 0));
	effect(() => liftSpring.setGoal(hovered() ? 1 : 0));

	return (
		<textbutton
			AutoButtonColor={false}
			BackgroundColor3={() => COLORS.disabled.Lerp(COLORS.confirm, math.clamp(slide(), 0, 1))}
			Position={position}
			Size={UDim2.fromScale(0.1, 0.16)}
			Text=""
			MouseEnter={() => hovered(true)}
			MouseLeave={() => hovered(false)}
			Activated={onToggle}
		>
			<uiaspectratioconstraint AspectRatio={2} />
			<uicorner CornerRadius={new UDim(0.5, 0)} />
			<uistroke ApplyStrokeMode={Enum.ApplyStrokeMode.Border} Color={COLORS.text} Thickness={1.5}>
				<EnergyGradient
					kind="field"
					base={() => COLORS.stroke.Lerp(COLORS.confirm, math.clamp(slide(), 0, 1))}
					energy={COLORS.text}
					charge={() => math.clamp(lift() + 0.4 * slide(), 0, 1)}
				/>
			</uistroke>
			<frame
				Name="Knob"
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Position={() => UDim2.fromScale(0.25 + 0.5 * slide(), 0.5)}
				Size={UDim2.fromScale(0.4, 0.8)}
			>
				<Shadow lift={lift} scale={0.4} />
				<frame BackgroundColor3={COLORS.text} Size={UDim2.fromScale(1, 1)} ZIndex={1}>
					<uicorner CornerRadius={new UDim(0.5, 0)} />
				</frame>
			</frame>
		</textbutton>
	);
}
