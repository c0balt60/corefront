import Vide, { effect, source } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Button } from "core/Interface/client/components/button";
import { Brackets } from "core/Interface/client/components/hud";
import { PANEL_CORNER, Panel } from "core/Interface/client/components/panel";
import { useAppear, useScramble, useSpin } from "core/Interface/client/motion";
import { COLORS, FONT, FONT_DISPLAY, FONT_LABEL, LEVEL_COLORS, SPRINGS } from "core/Interface/client/theme";
import { LEVEL_NAMES, type Planet, type PlanetKind } from "core/Worlds/shared/star-system";

const DESCRIPTIONS: Record<PlanetKind, string> = {
	Habitable: "Habitable planet with plenty of basic resources.",
	Barren: "Barren planet with little water and rich minerals.",
	Frozen: "Frozen planet where deep ice hides rare resources.",
	Volcanic: "Volcanic planet with extreme heat and rare metals.",
};

/** Stiffer and wilder than any `SPRINGS` preset, so a refused click rattles instead of sways. */
export const SHAKE = { tension: 700, friction: 15 };
/** The sideways speed, in pixels per second, a refused click kicks the button with. */
export const SHAKE_KICK = 400;

/** The hazard tint of a locked planet: amber, the middle of `LEVEL_COLORS`. */
export const HAZARD = LEVEL_COLORS[2];
/** A gradient's transparency that makes ten soft diagonal stripes, as many keypoints as a sequence allows. */
export const STRIPES = (() => {
	const keypoints = new Array<NumberSequenceKeypoint>();
	for (let i = 0; i < 20; i++) keypoints.push(new NumberSequenceKeypoint(i / 19, i % 2 === 0 ? 1 : 0.9));
	return new NumberSequence(keypoints);
})();
/** A bright spot that fades out at both ends, for the glint racing along the underline. */
const GLINT = new NumberSequence([
	new NumberSequenceKeypoint(0, 1),
	new NumberSequenceKeypoint(0.7, 0.3),
	new NumberSequenceKeypoint(1, 1),
]);

const clamp01 = (value: number) => math.clamp(value, 0, 1);

/** A status chip's colours: unlocked, on a mission, and locked. */
export interface ChipPalette {
	readonly live: Color3;
	readonly mission: Color3;
	readonly locked: Color3;
}

const CHIP_PALETTE: ChipPalette = { live: COLORS.confirm, mission: COLORS.accent, locked: COLORS.subtext };

interface StatusChipProps {
	readonly label: () => string;
	/** Green, accent and grey unless given. */
	readonly palette?: ChipPalette;
	/** 0-1: how locked the chip looks, springing between its two states. */
	readonly lock: () => number;
	/** 0-1: how far the chip has turned accent and widened, for the planet a mission is on. */
	readonly mission: () => number;
	/** 0-1: how far the chip has faded in. */
	readonly reveal: () => number;
	/** 0-1: how far its brackets stand off the corners. */
	readonly open: () => number;
	/** Multiplies the label's largest size, for a panel that needs bigger text. */
	readonly textScale?: number;
}

/**
 * A tag with brackets on its corners: a blinking green dot and UNLOCKED (or
 * LIBERATED), a blinking accent dot and MISSION IN PROGRESS on a wider chip, or
 * a padlock and LOCKED in grey. Its colours and width spring between them, the
 * dot and the padlock cross-fade, and the label decodes on every change.
 */
export function StatusChip({
	label,
	lock,
	mission,
	reveal,
	open,
	palette = CHIP_PALETTE,
	textScale = 1,
}: StatusChipProps) {
	const text = useScramble("chip", label, 0.05, 0.35);
	const blink = useSpin(() => 240);
	const live = () => palette.live.Lerp(palette.mission, mission());
	const tone = () => live().Lerp(palette.locked, lock());
	const dot = () => 1 - reveal() * (1 - lock()) * (0.55 + 0.45 * math.sin(math.rad(blink())));
	const padlock = () => 1 - reveal() * lock();

	return (
		<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 0.05)}>
			<frame BackgroundTransparency={1} Size={() => UDim2.fromScale(0.4 + 0.32 * mission(), 1)}>
				<frame
					BackgroundColor3={tone}
					BackgroundTransparency={() => 1 - 0.15 * reveal()}
					Size={UDim2.fromScale(1, 1)}
				>
					<uicorner CornerRadius={new UDim(0.2, 0)} />
					<uistroke Color={tone} Thickness={1} Transparency={() => 1 - 0.6 * reveal()} />
					<frame
						AnchorPoint={new Vector2(0, 0.5)}
						BackgroundTransparency={1}
						Position={UDim2.fromScale(0.06, 0.5)}
						Size={UDim2.fromScale(0.1, 0.5)}
					>
						<uiaspectratioconstraint DominantAxis={Enum.DominantAxis.Height} />
						<frame BackgroundColor3={live} BackgroundTransparency={dot} Size={UDim2.fromScale(1, 1)}>
							<uicorner CornerRadius={new UDim(0.5, 0)} />
						</frame>
						{/* The padlock: a ring for the shackle, with its lower half hidden behind the body. */}
						<frame
							AnchorPoint={new Vector2(0.5, 0)}
							BackgroundTransparency={1}
							Position={UDim2.fromScale(0.5, 0)}
							Size={UDim2.fromScale(0.6, 0.8)}
						>
							<uicorner CornerRadius={new UDim(0.5, 0)} />
							<uistroke Color={palette.locked} Thickness={1.5} Transparency={padlock} />
						</frame>
						<frame
							AnchorPoint={new Vector2(0.5, 1)}
							BackgroundColor3={palette.locked}
							BackgroundTransparency={padlock}
							BorderSizePixel={0}
							Position={UDim2.fromScale(0.5, 1)}
							Size={UDim2.fromScale(1, 0.55)}
						>
							<uicorner CornerRadius={new UDim(0.15, 0)} />
						</frame>
					</frame>
					<textlabel
						BackgroundTransparency={1}
						FontFace={FONT_LABEL}
						Position={UDim2.fromScale(0.18, 0)}
						Size={UDim2.fromScale(0.78, 1)}
						Text={text}
						TextColor3={() => live().Lerp(COLORS.muted, lock())}
						TextScaled={true}
						TextTransparency={() => 1 - reveal()}
						TextXAlignment={Enum.TextXAlignment.Left}
					>
						<uitextsizeconstraint MaxTextSize={13 * textScale} />
						<uipadding PaddingBottom={new UDim(0.2, 0)} PaddingTop={new UDim(0.2, 0)} />
					</textlabel>
				</frame>
				<Brackets
					kind="chip"
					color={palette.live}
					length={6}
					open={open}
					thickness={1}
					visibility={() => reveal() * (1 - lock()) * (1 - mission())}
				/>
				<Brackets
					kind="chip"
					color={palette.mission}
					length={6}
					open={open}
					thickness={1}
					visibility={() => reveal() * (1 - lock()) * mission()}
				/>
				<Brackets
					kind="chip"
					color={palette.locked}
					length={6}
					open={open}
					thickness={1}
					visibility={() => reveal() * lock()}
				/>
			</frame>
		</frame>
	);
}

interface UnderlineProps {
	/** 0-1: how far the line has grown. */
	readonly progress: () => number;
	readonly color: () => Color3;
}

/** A thin line that grows to full width while a glint races along it, a little ahead of its end. */
export function Underline({ progress, color }: UnderlineProps) {
	return (
		<frame BackgroundTransparency={1} ClipsDescendants={true} Size={new UDim2(1, 0, 0, 2)}>
			<frame BackgroundColor3={color} BorderSizePixel={0} Size={() => UDim2.fromScale(progress(), 1)} />
			<frame
				BackgroundColor3={COLORS.text}
				BorderSizePixel={0}
				Position={() => UDim2.fromScale(progress() * 1.25 - 0.25, 0)}
				Size={UDim2.fromScale(0.25, 1)}
			>
				<uigradient Transparency={GLINT} />
			</frame>
		</frame>
	);
}

interface LevelBarProps {
	/** 0-4, see `LEVEL_NAMES`. */
	readonly level: () => number;
	/** 0-1: how far the row has revealed. The segments fill from the left as it rises. */
	readonly reveal: () => number;
}

/** Five segments in the `LEVEL_COLORS` scale, lit up to the level. Unlit ones stay as a faint ghost. */
function LevelBar({ level, reveal }: LevelBarProps) {
	return (
		<frame
			AnchorPoint={new Vector2(0, 0.5)}
			BackgroundTransparency={1}
			Position={UDim2.fromScale(0.38, 0.5)}
			Size={UDim2.fromScale(0.26, 0.28)}
		>
			<uilistlayout FillDirection={Enum.FillDirection.Horizontal} Padding={new UDim(0.05, 0)} />
			{LEVEL_COLORS.map((color, index) => (
				<frame
					BackgroundColor3={color}
					BackgroundTransparency={() => {
						const lit = clamp01((level() + 1) * reveal() - index);
						return 1 - clamp01(reveal()) * (0.15 + 0.85 * lit);
					}}
					BorderSizePixel={0}
					Size={UDim2.fromScale(0.16, 1)}
				>
					<uicorner CornerRadius={new UDim(0.2, 0)} />
				</frame>
			))}
		</frame>
	);
}

interface RowProps {
	readonly label: string;
	readonly value: () => string;
	readonly color?: () => Color3;
	/** 0-4: shows a segmented bar between the label and the value. */
	readonly level?: () => number;
	/** 0-1: how far the row has slid and faded in. */
	readonly reveal: () => number;
	/** Seconds the value stays blank when it first mounts, to follow the rows above it. */
	readonly delay: number;
	/** Multiplies the text's largest size, for a panel that needs bigger text. */
	readonly textScale?: number;
}

/**
 * One label and value on a line, the value on the right and decoding whenever
 * it changes. The value's colour springs when it changes. A row with a level
 * has its bar in the middle.
 */
export function Row({ label, value, color = () => COLORS.text, level, reveal, delay, textScale = 1 }: RowProps) {
	const [tint, tintSpring] = useSpring(color(), SPRINGS.responsive);
	const text = useScramble("text", value, delay);
	effect(() => tintSpring.setGoal(color()));

	return (
		<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 0.07)}>
			<frame
				BackgroundTransparency={1}
				Position={() => UDim2.fromOffset(-16 * (1 - reveal()), 0)}
				Size={UDim2.fromScale(1, 1)}
			>
				<textlabel
					BackgroundTransparency={1}
					FontFace={FONT_LABEL}
					Size={UDim2.fromScale(0.36, 1)}
					Text={label}
					TextColor3={COLORS.muted}
					TextScaled={true}
					TextTransparency={() => 1 - reveal()}
					TextXAlignment={Enum.TextXAlignment.Left}
				>
					<uitextsizeconstraint MaxTextSize={13 * textScale} />
				</textlabel>
				{level ? <LevelBar level={level} reveal={reveal} /> : undefined}
				<textlabel
					AnchorPoint={new Vector2(1, 0)}
					BackgroundTransparency={1}
					FontFace={FONT_DISPLAY}
					Position={UDim2.fromScale(1, 0)}
					Size={UDim2.fromScale(level ? 0.34 : 0.62, 1)}
					Text={text}
					TextColor3={tint}
					TextScaled={true}
					TextTransparency={() => 1 - reveal()}
					TextXAlignment={Enum.TextXAlignment.Right}
				>
					<uitextsizeconstraint MaxTextSize={16 * textScale} />
				</textlabel>
			</frame>
		</frame>
	);
}

interface PlanetPanelProps {
	readonly planet: () => Planet;
	/** Whether the planet can be deployed to. */
	readonly unlocked: () => boolean;
	/** The world's standing on the planet: liberated, or the one a mission is on. */
	readonly standing?: () => "liberated" | "active" | undefined;
	/** Why an unlocked planet can't be deployed to right now, shown on the button in place of its action. */
	readonly blocked?: () => string | undefined;
	/** What the button says when it can be clicked. */
	readonly action?: () => string;
	readonly onDeploy: () => void;
	/**
	 * Turns false to slide the panel out. Return `$tuple(node, EXIT_TIME)` from
	 * the Show that renders it, so it stays mounted while it does.
	 */
	readonly show?: () => boolean;
}

/**
 * The left-hand panel that describes the selected planet and deploys to it. It
 * slides in from the left, its rows following one after another. Picking
 * another planet scans the panel again and replays its details: the name and
 * values decode, the underline redraws with a glint and the level bars refill.
 * A status chip says whether the planet is unlocked, liberated or under a
 * mission; a locked one gets the same details under faint hazard stripes. A
 * refused deploy says why on the button, and clicking it shakes it.
 */
export function PlanetPanel({
	planet,
	unlocked,
	standing = () => undefined,
	blocked = () => undefined,
	action = () => "DEPLOY",
	onDeploy,
	show,
}: PlanetPanelProps) {
	const slide = useAppear(show);
	const hovered = source(false);
	const [lift, liftSpring] = useSpring(0, SPRINGS.responsive);
	const [shake, shakeSpring] = useSpring(0, SHAKE);
	// 0-1, restarting whenever the planet changes: the fade of its details.
	const [swap, swapSpring] = useSpring(0, SPRINGS.smooth);
	// 0-1: 1 while the planet is locked, which fades in the stripes and greys the chip and underline.
	const [rawLock, lockSpring] = useSpring(unlocked() ? 0 : 1, SPRINGS.responsive);
	// 0-1: 1 while a mission is on the planet, which turns the chip accent.
	const [rawMission, missionSpring] = useSpring(standing() === "active" ? 1 : 0, SPRINGS.responsive);

	effect(() => liftSpring.setGoal(hovered() ? 0.5 : 0));
	effect(() => lockSpring.setGoal(unlocked() ? 0 : 1));
	effect(() => missionSpring.setGoal(standing() === "active" ? 1 : 0));
	effect(() => {
		planet();
		swapSpring.setPosition(0);
		swapSpring.halt();
		swapSpring.setGoal(1);
	});

	const refused = () => !unlocked() || blocked() !== undefined;
	const chipLabel = () => {
		if (!unlocked()) return "LOCKED";
		const status = standing();
		return status === "active" ? "MISSION IN PROGRESS" : status === "liberated" ? "LIBERATED" : "UNLOCKED";
	};
	const lock = () => clamp01(rawLock());
	const fade = () => 1 - swap();
	/** The chip's brackets jump off the corners with every new planet and settle back. */
	const flash = () => 0.3 + 0.7 * fade();
	const name = useScramble("text", () => planet().name.upper(), 0.1, 0.5);
	/** Seconds a row waits after the panel opens, later for each row down the list. */
	const stagger = (row: number) => 0.05 + row * 0.05;
	/** A row's own 0-1, later for each row down the list, and restarting with every new planet. */
	const reveal = (row: number) => {
		const appear = useAppear(show, stagger(row));
		return () => appear() * swap();
	};
	const levelRow = (label: string, row: number, value: (planet: Planet) => number) => (
		<Row
			delay={stagger(row)}
			label={label}
			level={() => value(planet())}
			reveal={reveal(row)}
			value={() => LEVEL_NAMES[value(planet())].upper()}
			color={() => LEVEL_COLORS[value(planet())]}
		/>
	);

	return (
		<frame
			Name="PlanetPanel"
			Active={true}
			BackgroundTransparency={1}
			Position={() => UDim2.fromScale(0.02 - 0.3 * (1 - slide()), 0.18)}
			Size={UDim2.fromScale(0.22, 0.62)}
			MouseEnter={() => hovered(true)}
			MouseLeave={() => hovered(false)}
		>
			<Panel lift={lift} rescan={planet}>
				{/* The hazard stripes of a locked planet, behind everything. */}
				<frame
					BackgroundColor3={HAZARD}
					BackgroundTransparency={() => 1 - lock()}
					BorderSizePixel={0}
					Size={UDim2.fromScale(1, 1)}
				>
					<uicorner CornerRadius={PANEL_CORNER} />
					<uigradient Rotation={45} Transparency={STRIPES} />
				</frame>

				<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 1)}>
					<uipadding
						PaddingBottom={new UDim(0.04, 0)}
						PaddingLeft={new UDim(0.06, 0)}
						PaddingRight={new UDim(0.06, 0)}
						PaddingTop={new UDim(0.04, 0)}
					/>

					<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 0.88)}>
						<uilistlayout Padding={new UDim(0.012, 0)} />
						<StatusChip
							label={chipLabel}
							lock={lock}
							mission={() => clamp01(rawMission())}
							open={flash}
							reveal={reveal(0)}
						/>
						<textlabel
							BackgroundTransparency={1}
							FontFace={FONT_DISPLAY}
							Size={UDim2.fromScale(1, 0.085)}
							Text={name}
							TextColor3={COLORS.text}
							TextScaled={true}
							TextTransparency={fade}
							TextXAlignment={Enum.TextXAlignment.Left}
						>
							<uitextsizeconstraint MaxTextSize={26} />
						</textlabel>
						<Underline progress={swap} color={() => COLORS.accent.Lerp(COLORS.subtext, lock())} />
						<textlabel
							BackgroundTransparency={1}
							FontFace={FONT}
							Size={UDim2.fromScale(1, 0.11)}
							Text={() => DESCRIPTIONS[planet().kind]}
							TextColor3={COLORS.muted}
							TextScaled={true}
							TextTransparency={fade}
							TextXAlignment={Enum.TextXAlignment.Left}
							TextYAlignment={Enum.TextYAlignment.Top}
						>
							<uitextsizeconstraint MaxTextSize={18} />
						</textlabel>
						<Row
							delay={stagger(1)}
							label="SEED"
							reveal={reveal(1)}
							value={() => tostring(planet().terrainSeed)}
						/>
						{/* The heading and a rule that draws itself out to the edge. */}
						<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 0.05)}>
							<textlabel
								BackgroundTransparency={1}
								FontFace={FONT_LABEL}
								Size={UDim2.fromScale(0.4, 1)}
								Text="SYSTEM INFO"
								TextColor3={COLORS.subtext}
								TextScaled={true}
								TextTransparency={fade}
								TextXAlignment={Enum.TextXAlignment.Left}
							>
								<uitextsizeconstraint MaxTextSize={13} />
							</textlabel>
							<frame
								AnchorPoint={new Vector2(0, 0.5)}
								BackgroundColor3={COLORS.subtext}
								BackgroundTransparency={0.5}
								BorderSizePixel={0}
								Position={UDim2.fromScale(0.42, 0.5)}
								Size={() => new UDim2(0.58 * swap(), 0, 0, 1)}
							/>
						</frame>
						<Row delay={stagger(2)} label="TYPE" reveal={reveal(2)} value={() => planet().kind.upper()} />
						{levelRow("DIFFICULTY", 3, (p) => p.difficulty)}
						{levelRow("ALIENS", 4, (p) => p.aliens)}
						{levelRow("RESOURCES", 5, (p) => p.resources)}
						<Row
							color={() => (planet().mission === "attack" ? COLORS.danger : COLORS.confirm)}
							delay={stagger(6)}
							label="MISSION"
							reveal={reveal(6)}
							value={() => (planet().mission === "attack" ? "ATTACK" : "DEFENSE")}
						/>
					</frame>

					<frame
						Name="PlanetAction"
						AnchorPoint={new Vector2(0, 1)}
						BackgroundTransparency={1}
						Position={() => new UDim2(0, shake(), 1, 0)}
						Size={UDim2.fromScale(1, 0.08)}
					>
						<Button
							color={COLORS.confirm}
							disabled={refused}
							onClick={onDeploy}
							size={UDim2.fromScale(1, 1)}
							text={() => (unlocked() ? (blocked() ?? action()) : "LOCKED")}
						/>
						{/* A refused button ignores clicks, so this one on top catches them and answers with a shake. */}
						<textbutton
							BackgroundTransparency={1}
							Size={UDim2.fromScale(1, 1)}
							Text=""
							Visible={refused}
							ZIndex={10}
							Activated={() => shakeSpring.impulse(SHAKE_KICK)}
						/>
					</frame>
				</frame>
			</Panel>
		</frame>
	);
}
