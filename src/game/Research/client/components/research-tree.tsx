import { GuiService, RunService, UserInputService, Workspace } from "@rbxts/services";
import Vide, { cleanup, derive, effect, Index, Show, source, untrack } from "@rbxts/vide";
import { useSpring, useTween } from "@rbxts/vide-ripple";

import { Button } from "core/Interface/client/components/button";
import { Brackets, EnergyGradient } from "core/Interface/client/components/hud";
import { MenuBackground } from "core/Interface/client/components/menu-background";
import { Panel } from "core/Interface/client/components/panel";
import { Shadow } from "core/Interface/client/components/shadow";
import { EXIT_TIME, useAppear, useScramble, useSpin } from "core/Interface/client/motion";
import { COLORS, FONT, FONT_DISPLAY, FONT_LABEL, hasEffect, SPRINGS } from "core/Interface/client/theme";
import { amountOf, canAfford } from "game/Base/client/base-state";
import { HudBox, Label, Swatch } from "game/Base/client/components/base-hud";
import { BUILDINGS } from "game/Base/shared/buildings";
import { RESOURCES, type ResourceStack } from "game/Base/shared/resources";
import {
	type ChipPalette,
	Row,
	SHAKE,
	SHAKE_KICK,
	StatusChip,
	STRIPES,
	Underline,
} from "game/Planets/client/components/planet-panel";
import { Glyph } from "game/Research/client/components/glyphs";
import {
	formatStat,
	isTeamNode,
	type Levels,
	levelCost,
	lockReason,
	maxLevel,
	RESEARCH,
	RESEARCH_ORDER,
	type ResearchGates,
	type ResearchId,
	STATS,
	statValue,
} from "game/Research/shared/research";

/** Pixels between node centres at zoom 1: across, and from one row to the next. */
const SPACING = new Vector2(136, 128);
const NODE = 60;
const CORE_NODE = 76;
/** Node outlines, drawn outside their tile. Brackets sit clear of them. */
const STROKE = 3;
/** Pixels between the screen's edges and the boxes along them. */
const EDGE = 16;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 1.12;
/** Pixels a press has to move before it pans rather than clicks. */
const DRAG_SLOP = 5;
/** Seconds the tree takes to grow out of the Core when it opens. */
const GROW_SECONDS = 1.1;
/** How fast the Core's pulse runs out along the traces, in pixels per second. */
const PULSE_SPEED = 260;
/** Seconds between one pulse reaching the end of the tree and the Core sending the next. */
const PULSE_REST = 1.6;
/** Seconds a node glows after the pulse passes through it. */
const PULSE_GLOW = 0.6;
const PULSING = hasEffect("research", "energy");
/** The glowing packet a pulse travels as, and a level pip's width. */
const PACKET = 8;
const PIP = 10;

const clamp01 = (value: number) => math.clamp(value, 0, 1);

/**
 * Each node's (column, row) around the Core at (0, 0): building branches grow
 * up (negative rows), the rest down. A node's parent is the first of its
 * `requires`, one row further from the Core, centred over its children.
 * Roots and siblings go left to right in `RESEARCH_ORDER`, and each side is
 * centred on the Core.
 */
function layout(): ReadonlyMap<ResearchId, Vector2> {
	const children = new Map<ResearchId, Array<ResearchId>>();
	const roots = { up: new Array<ResearchId>(), down: new Array<ResearchId>() };
	for (const id of RESEARCH_ORDER) {
		const parent = RESEARCH[id].requires[0];
		if (parent === undefined) roots[RESEARCH[id].side ?? "down"].push(id);
		else children.set(parent, [...(children.get(parent) ?? []), id]);
	}

	const positions = new Map<ResearchId, Vector2>();
	for (const [side, sign] of [
		["up", -1],
		["down", 1],
	] as const) {
		const placed = new Array<ResearchId>();
		let nextColumn = 0;
		const place = (id: ResearchId, depth: number): number => {
			const columns = (children.get(id) ?? []).map((child) => place(child, depth + 1));
			const column = columns.isEmpty() ? nextColumn++ : (columns[0] + columns[columns.size() - 1]) / 2;
			positions.set(id, new Vector2(column, sign * depth));
			placed.push(id);
			return column;
		};
		for (const root of roots[side]) place(root, 1);
		const shift = new Vector2((nextColumn - 1) / 2, 0);
		for (const id of placed) positions.set(id, positions.get(id)!.sub(shift));
	}
	// A node whose parents loop back on themselves never hangs off a root.
	assert(positions.size() === RESEARCH_ORDER.size(), "A research node's requires loop back on themselves");
	return positions;
}

const POSITIONS = layout();
/** How far the furthest node is from the Core, across and down, in grid cells. */
let extent = Vector2.zero;
for (const [, cell] of POSITIONS) extent = extent.Max(new Vector2(math.abs(cell.X), math.abs(cell.Y)));

function pixels(cell: Vector2): Vector2 {
	return cell.mul(SPACING);
}

/** The elbow from one cell's centre to another's, in canvas pixels: out, across at the halfway row, and in. */
function elbow(from: Vector2, to: Vector2): ReadonlyArray<Vector2> {
	const a = pixels(from);
	const b = pixels(to);
	const middle = (a.Y + b.Y) / 2;
	return [a, new Vector2(a.X, middle), new Vector2(b.X, middle), b];
}

function lengthOf(points: ReadonlyArray<Vector2>): number {
	let length = 0;
	for (let i = 1; i < points.size(); i++) length += points[i].sub(points[i - 1]).Magnitude;
	return length;
}

/** The point `distance` pixels along `points`. */
function along(points: ReadonlyArray<Vector2>, distance: number): Vector2 {
	for (let i = 1; i < points.size(); i++) {
		const step = points[i].sub(points[i - 1]);
		if (distance <= step.Magnitude) return points[i - 1].add(step.mul(distance / math.max(step.Magnitude, 1e-3)));
		distance -= step.Magnitude;
	}
	return points[points.size() - 1];
}

/** Pixels along the traces from the Core to each node, through its parents. */
const REACH = new Map<ResearchId, number>();
function reachOf(id: ResearchId): number {
	const known = REACH.get(id);
	if (known !== undefined) return known;
	const parent = RESEARCH[id].requires[0];
	const from = parent !== undefined ? POSITIONS.get(parent)! : Vector2.zero;
	const reach = (parent !== undefined ? reachOf(parent) : 0) + lengthOf(elbow(from, POSITIONS.get(id)!));
	REACH.set(id, reach);
	return reach;
}

interface Trace {
	readonly to: ResearchId;
	/** Its corners in canvas pixels, from what it needs (or the Core) to `to`. */
	readonly points: ReadonlyArray<Vector2>;
	readonly length: number;
	/** Pixels along the traces from the Core to where it starts. */
	readonly start: number;
}

/** A trace into every node from each node it needs, and into each root from the Core. */
const TRACES = new Array<Trace>();
for (const id of RESEARCH_ORDER) {
	const requires = RESEARCH[id].requires;
	for (const from of requires.isEmpty() ? [undefined] : requires) {
		const points = elbow(from !== undefined ? POSITIONS.get(from)! : Vector2.zero, POSITIONS.get(id)!);
		TRACES.push({ to: id, points, length: lengthOf(points), start: from !== undefined ? reachOf(from) : 0 });
	}
}
/** Where the furthest trace ends: how far the tree grows, and each pulse runs. */
const FURTHEST = TRACES.reduce((most, trace) => math.max(most, trace.start + trace.length), 0);
/** Pixels the pulse covers from leaving the Core to leaving it again. */
const CYCLE = FURTHEST + PULSE_SPEED * PULSE_REST;

type NodeState = "done" | "open" | "locked";

/** The tree's palette: amber for researched and the Core that powers it, blue for researchable now, red for locked. */
const AMBER = Color3.fromRGB(255, 176, 60);
const BLUE = Color3.fromRGB(70, 150, 255);
const RED = COLORS.danger;
const STATE_COLORS: Record<NodeState, Color3> = { done: AMBER, open: BLUE, locked: RED };
/** Locked lines are darker, so they sit back behind the live ones. */
const LINE_COLORS: Record<NodeState, Color3> = { done: AMBER, open: BLUE, locked: RED.Lerp(COLORS.card, 0.55) };
/** The panel's status chip, in the same colours. */
const CHIP: ChipPalette = { live: BLUE, mission: AMBER, locked: RED };
/** How bright the Core's pulse lights a node, against hovering's 0.5 and picking's 1. */
const PULSE_SHINE = 0.4;
/** How much bigger the side panel's text is than the planet panel's, so it reads from across the screen. */
const TEXT_SCALE = 1.35;
const LINE_WIDTHS: Record<NodeState, number> = { done: 4, open: 3, locked: 2 };
const STATE_NAMES: Record<NodeState, string> = { done: "RESEARCHED", open: "AVAILABLE", locked: "LOCKED" };
/** Brighter lines draw over dimmer ones where branches share a bar. */
const LINE_ORDER: Record<NodeState, number> = { locked: 1, open: 2, done: 3 };

/** The research the Core's own stats come from. */
const TEAM_NODES = RESEARCH_ORDER.filter(isTeamNode);

/** Brackets round a tile, pushed out past its `STROKE`-wide outline so they frame it instead of drawing over it. */
function OutlineBrackets(props: {
	readonly open: () => number;
	readonly visibility: () => number;
	readonly color: () => Color3;
}) {
	return (
		<frame
			AnchorPoint={new Vector2(0.5, 0.5)}
			BackgroundTransparency={1}
			Position={UDim2.fromScale(0.5, 0.5)}
			Size={new UDim2(1, STROKE * 2, 1, STROKE * 2)}
			ZIndex={2}
		>
			<Brackets
				kind="research"
				color={props.color}
				open={props.open}
				visibility={props.visibility}
				length={10}
				thickness={2}
			/>
		</frame>
	);
}

interface TraceLineProps {
	readonly trace: Trace;
	readonly state: () => NodeState;
	/** Pixels from the Core the tree has grown. */
	readonly grown: () => number;
	/** Pixels from the Core the pulse has run, or below 0 when there's none. */
	readonly pulse: () => number;
}

/**
 * A trace into a node, in its state's colour, like a route on the star map: it
 * draws itself out from the Core as the tree grows, and once the node is in
 * reach, the Core's pulse runs down it as a glowing packet.
 */
function TraceLine({ trace, state, grown, pulse }: TraceLineProps) {
	const [tint, tintSpring] = useSpring(LINE_COLORS[state()], SPRINGS.responsive);
	effect(() => tintSpring.setGoal(LINE_COLORS[state()]));
	const width = () => LINE_WIDTHS[state()];
	const drawn = () => math.clamp(grown() - trace.start, 0, trace.length);
	/** How far along it the pulse is, while it's on it. */
	const packet = () => {
		const at = pulse() - trace.start;
		return state() !== "locked" && drawn() >= trace.length && at >= 0 && at <= trace.length ? at : undefined;
	};

	const segments = new Array<{ a: Vector2; b: Vector2; start: number; length: number }>();
	let distance = 0;
	for (let i = 1; i < trace.points.size(); i++) {
		const [a, b] = [trace.points[i - 1], trace.points[i]];
		const length = b.sub(a).Magnitude;
		if (length > 0) segments.push({ a, b, start: distance, length });
		distance += length;
	}

	return (
		<>
			{segments.map(({ a, b, start, length }) => {
				const tip = () => a.Lerp(b, clamp01((drawn() - start) / length));
				return (
					<frame
						BackgroundColor3={tint}
						BorderSizePixel={0}
						Position={() => {
							const min = a.Min(tip());
							return UDim2.fromOffset(min.X - width() / 2, min.Y - width() / 2);
						}}
						Size={() => {
							const size = tip().sub(a);
							return UDim2.fromOffset(math.abs(size.X) + width(), math.abs(size.Y) + width());
						}}
						Visible={() => drawn() > start}
						ZIndex={() => LINE_ORDER[state()]}
					/>
				);
			})}
			<frame
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Position={() => {
					const at = along(trace.points, packet() ?? 0);
					return UDim2.fromOffset(at.X, at.Y);
				}}
				Rotation={45}
				Size={UDim2.fromOffset(PACKET, PACKET)}
				Visible={() => packet() !== undefined}
				ZIndex={5}
			>
				<Shadow lift={() => 0.3} tint={tint} scale={0.3} visibility={() => 0.5} />
				<frame
					BackgroundColor3={() => tint().Lerp(COLORS.text, 0.3)}
					BorderSizePixel={0}
					Size={UDim2.fromScale(1, 1)}
					ZIndex={1}
				/>
			</frame>
		</>
	);
}

interface TileProps {
	/** Its centre on the canvas, in pixels. */
	readonly at: Vector2;
	readonly size: number;
	/** Its outline, glow and brackets. */
	readonly color: () => Color3;
	/** The light running round its outline. `color` hides it. */
	readonly energy: () => Color3;
	/** 0-1: how far it has popped in. Past 1 swells it. */
	readonly pop: () => number;
	/** 0-1: a glow on top of hovering's, as a pulse passes through. */
	readonly glow: () => number;
	readonly selected: () => boolean;
	readonly onClick: () => void;
	/** What's on the tile, given its fill (which glyphs cut their holes in) and how far hovering has lifted it. */
	readonly content: (fill: () => Color3, lift: () => number) => Vide.Node;
}

/**
 * A square tile on the canvas, like a build card: outlined, shadowed and
 * bracketed in `color`. Hovering lifts it and picking it grows it.
 */
function Tile({ at, size, color, energy, pop, glow, selected, onClick, content }: TileProps) {
	const hovered = source(false);
	const [lift, liftSpring] = useSpring(0, SPRINGS.responsive);
	const [scale, scaleSpring] = useSpring(1, SPRINGS.bouncy);
	effect(() => {
		liftSpring.setGoal(selected() ? 1 : hovered() ? 0.5 : 0);
		scaleSpring.setGoal(selected() ? 1.08 : hovered() ? 1.04 : 1);
	});
	const fill = () => COLORS.card.Lerp(COLORS.cardHover, clamp01(lift()));

	return (
		<frame
			AnchorPoint={new Vector2(0.5, 0.5)}
			BackgroundTransparency={1}
			Position={UDim2.fromOffset(at.X, at.Y)}
			Size={UDim2.fromOffset(size, size)}
			Visible={() => pop() > 0.01}
			ZIndex={10}
		>
			<uiscale Scale={() => math.max(pop() * scale(), 0.01)} />
			{/* Faint at rest, so the tree reads as lit from within rather than glowing all over. */}
			<Shadow
				lift={() => math.max(lift(), glow())}
				tint={color}
				scale={0.5}
				visibility={() => 0.35 + 0.4 * clamp01(math.max(lift(), glow()))}
			/>
			<textbutton
				AutoButtonColor={false}
				BackgroundColor3={fill}
				BorderSizePixel={0}
				Size={UDim2.fromScale(1, 1)}
				Text=""
				ZIndex={1}
				Activated={onClick}
				MouseEnter={() => hovered(true)}
				MouseLeave={() => hovered(false)}
			>
				<uistroke
					ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
					Color={COLORS.text}
					LineJoinMode={Enum.LineJoinMode.Miter}
					Thickness={STROKE}
				>
					<EnergyGradient kind="research" base={color} energy={energy} charge={lift} />
				</uistroke>
				{content(fill, lift)}
			</textbutton>
			<OutlineBrackets color={color} open={lift} visibility={lift} />
		</frame>
	);
}

/** The middle of a tile, where its icon goes. */
function IconSlot({ children }: { readonly children: Vide.Node }) {
	return (
		<frame
			AnchorPoint={new Vector2(0.5, 0.5)}
			BackgroundTransparency={1}
			Position={UDim2.fromScale(0.5, 0.5)}
			Size={UDim2.fromScale(0.6, 0.6)}
			ZIndex={2}
		>
			{children}
		</frame>
	);
}

interface NodeButtonProps {
	readonly id: ResearchId;
	readonly level: () => number;
	readonly state: () => NodeState;
	readonly selected: () => boolean;
	/** 0-1: how far it has popped in. */
	readonly pop: () => number;
	/** 0-1: the Core's pulse passing through. */
	readonly pulse: () => number;
	readonly onClick: () => void;
}

/**
 * A node's tile in its state's colour. Researched ones glow as the Core's pulse
 * passes through them, available ones have energy running round their outline,
 * and locked ones show a padlock over hazard stripes, like a locked planet. Its
 * levels show as pips underneath, and its name decodes in while it's hovered.
 * Researching it sends a shockwave out from it.
 */
function NodeButton({ id, level, state, selected, pop, pulse, onClick }: NodeButtonProps) {
	const node = RESEARCH[id];
	const [tint, tintSpring] = useSpring(STATE_COLORS[state()], SPRINGS.responsive);
	const [lock, lockSpring] = useSpring(state() === "locked" ? 1 : 0, SPRINGS.responsive);
	// Back to 0 the moment a level is researched, springing to 1: the shockwave and the flash and swell with it.
	const [burst, burstSpring] = useSpring(1, SPRINGS.smooth);
	effect(() => {
		tintSpring.setGoal(STATE_COLORS[state()]);
		lockSpring.setGoal(state() === "locked" ? 1 : 0);
	});
	let last = untrack(level);
	effect(() => {
		const current = level();
		if (current > last) {
			burstSpring.setPosition(0);
			burstSpring.halt();
			burstSpring.setGoal(1);
		}
		last = current;
	});
	const flash = () => 1 - clamp01(burst());
	const pips = new Array<number>();
	for (let index = 0; index < maxLevel(id); index++) pips.push(index);

	return (
		<Tile
			at={pixels(POSITIONS.get(id)!)}
			size={NODE}
			color={tint}
			energy={() => (state() === "open" ? tint().Lerp(COLORS.text, 0.45) : tint())}
			pop={() => pop() * (1 + 0.15 * flash())}
			glow={() => math.max(pulse(), flash())}
			selected={selected}
			onClick={onClick}
			content={(fill, lift) => {
				// Derived, so the name decodes as hovering starts, not on every frame of the lift.
				const name = useScramble(
					"research",
					derive(() => (lift() > 0.25 ? node.name.upper() : "")),
					0,
					0.3,
				);
				return (
					<>
						<frame
							BackgroundColor3={RED}
							BackgroundTransparency={() => 1 - lock()}
							BorderSizePixel={0}
							Size={UDim2.fromScale(1, 1)}
							ZIndex={1}
						>
							<uigradient Rotation={45} Transparency={STRIPES} />
						</frame>
						{/* Built once and toggled: creating them inside a reactive child would nest reactive scopes. */}
						<IconSlot>
							{node.image !== undefined ? (
								<imagelabel
									BackgroundTransparency={1}
									Image={node.image}
									Size={UDim2.fromScale(1, 1)}
									Visible={() => state() !== "locked"}
								/>
							) : (
								<Glyph
									glyph={node.glyph}
									color={tint}
									background={fill}
									visible={() => state() !== "locked"}
								/>
							)}
							<Glyph glyph="lock" color={tint} background={fill} visible={() => state() === "locked"} />
						</IconSlot>
						{pips.size() > 1 ? (
							<frame
								AnchorPoint={new Vector2(0.5, 0)}
								BackgroundTransparency={1}
								Position={new UDim2(0.5, 0, 1, STROKE + 6)}
								Size={UDim2.fromOffset(pips.size() * (PIP + 3) - 3, 4)}
							>
								<uilistlayout
									FillDirection={Enum.FillDirection.Horizontal}
									Padding={new UDim(0, 3)}
									SortOrder={Enum.SortOrder.LayoutOrder}
								/>
								{pips.map((index) => (
									<frame
										BackgroundColor3={tint}
										BackgroundTransparency={() => (level() > index ? 0 : 0.7)}
										BorderSizePixel={0}
										LayoutOrder={index}
										Size={UDim2.fromOffset(PIP, 4)}
									/>
								))}
							</frame>
						) : undefined}
						<textlabel
							AnchorPoint={new Vector2(0.5, 0)}
							BackgroundTransparency={1}
							FontFace={FONT_LABEL}
							Position={new UDim2(0.5, 0, 1, STROKE + 14)}
							Size={UDim2.fromOffset(180, 14)}
							Text={name}
							TextColor3={COLORS.text}
							TextSize={12}
							TextStrokeTransparency={0.5}
							TextTransparency={() => 1 - clamp01(lift() * 2)}
							ZIndex={4}
						/>
						<frame
							AnchorPoint={new Vector2(0.5, 0.5)}
							BackgroundTransparency={1}
							Position={UDim2.fromScale(0.5, 0.5)}
							Size={() => UDim2.fromScale(1 + 1.4 * clamp01(burst()), 1 + 1.4 * clamp01(burst()))}
							Visible={() => flash() > 0.01}
							ZIndex={5}
						>
							<uistroke
								Color={tint}
								LineJoinMode={Enum.LineJoinMode.Miter}
								Thickness={() => 1 + 4 * flash()}
								Transparency={() => 1 - flash()}
							/>
						</frame>
					</>
				);
			}}
		/>
	);
}

/**
 * Targeting brackets round the picked tile in its colour, like the star map's: they turn slowly, and every pick snaps
 * them in from wide.
 */
function Reticle({ target }: { readonly target: () => { at: Vector2; size: number; color: Color3 } | undefined }) {
	const angle = useSpin(() => 35);
	const [lock, lockSpring] = useSpring(1, SPRINGS.bouncy);
	effect(() => {
		target();
		lockSpring.setPosition(2.4);
		lockSpring.halt();
		lockSpring.setGoal(1);
	});

	return (
		<frame
			AnchorPoint={new Vector2(0.5, 0.5)}
			BackgroundTransparency={1}
			Position={() => {
				const at = target()?.at ?? Vector2.zero;
				return UDim2.fromOffset(at.X, at.Y);
			}}
			Rotation={angle}
			Size={() => {
				const size = (target()?.size ?? 0) + 30;
				return UDim2.fromOffset(size, size);
			}}
			Visible={() => target() !== undefined}
			ZIndex={15}
		>
			<uiscale Scale={lock} />
			<Brackets
				kind="reticle"
				color={() => target()?.color ?? AMBER}
				open={() => 0.3}
				length={12}
				visibility={() => clamp01(2.4 - lock())}
			/>
		</frame>
	);
}

/** The tree's title, top centre, like the loading screen's logo: it glitches in over an accent ghost as brackets lock on. */
function TreeTitle({ now, top }: { readonly now: () => number; readonly top: number }) {
	const intro = useAppear(undefined, 0.1, SPRINGS.bouncy);
	const fade = () => 1 - clamp01(intro());
	// Two decodes of the same word, so while it settles the letters ghost against each other.
	const title = useScramble("research", () => "RESEARCH", 0.1, 0.6);
	const ghost = useScramble("research", () => "RESEARCH", 0.1, 0.6);
	const caption = useScramble("research", () => "TECH TREE   ·   PAID FROM THE CORE", 0.4, 0.5);
	/** 1 as it arrives, easing out over most of a second. */
	const glitch = () => (hasEffect("research", "glitch") ? clamp01(1 - (now() - 0.1) / 0.7) : 0);
	/** A random number from -1 to 1 that changes 24 times a second. Each channel gives its own. */
	const jitter = (channel: number) => math.noise(math.floor(now() * 24) + 0.37, channel + 0.71) * 2;

	return (
		<frame
			AnchorPoint={new Vector2(0.5, 0)}
			BackgroundTransparency={1}
			Position={new UDim2(0.5, 0, 0, top)}
			Size={UDim2.fromOffset(260, 44)}
		>
			<uiscale Scale={() => 0.8 + 0.2 * intro()} />
			<textlabel
				BackgroundTransparency={1}
				FontFace={FONT_DISPLAY}
				Position={() => UDim2.fromOffset(4 + 12 * glitch() * jitter(1), 4 + 4 * glitch() * jitter(2))}
				Size={UDim2.fromScale(1, 1)}
				Text={ghost}
				TextColor3={COLORS.accent}
				TextSize={36}
				TextTransparency={fade}
				ZIndex={1}
			>
				<uistroke Color={COLORS.stroke} Thickness={2} Transparency={fade} />
			</textlabel>
			<textlabel
				BackgroundTransparency={1}
				FontFace={FONT_DISPLAY}
				Position={() => UDim2.fromOffset(6 * glitch() * jitter(4), 0)}
				Size={UDim2.fromScale(1, 1)}
				Text={title}
				TextColor3={COLORS.text}
				TextSize={36}
				// Drops out now and then while it glitches, never fully.
				TextTransparency={() => math.clamp(fade() + (glitch() * jitter(3) > 0.2 ? 0.5 : 0), 0, 1)}
				ZIndex={2}
			/>
			<Brackets
				kind="research"
				open={() => 0.2 + 1.6 * fade()}
				visibility={() => 1 - fade()}
				length={14}
				zIndex={3}
			/>
			<textlabel
				AnchorPoint={new Vector2(0.5, 0)}
				BackgroundTransparency={1}
				FontFace={FONT_LABEL}
				Position={new UDim2(0.5, 0, 1, 12)}
				Size={UDim2.fromOffset(400, 14)}
				Text={caption}
				TextColor3={COLORS.muted}
				TextSize={13}
				TextTransparency={fade}
			/>
		</frame>
	);
}

/** A small heading and a rule that draws itself out to the edge, as in the planet panel. */
function Heading({ text, swap }: { readonly text: string | (() => string); readonly swap: () => number }) {
	return (
		<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 0.05)}>
			<textlabel
				BackgroundTransparency={1}
				FontFace={FONT_LABEL}
				Size={UDim2.fromScale(0.6, 1)}
				Text={text}
				TextColor3={COLORS.subtext}
				TextScaled={true}
				TextTransparency={() => 1 - swap()}
				TextXAlignment={Enum.TextXAlignment.Left}
			>
				<uitextsizeconstraint MaxTextSize={13 * TEXT_SCALE} />
			</textlabel>
			<frame
				AnchorPoint={new Vector2(0, 0.5)}
				BackgroundColor3={COLORS.subtext}
				BackgroundTransparency={0.5}
				BorderSizePixel={0}
				Position={UDim2.fromScale(0.62, 0.5)}
				Size={() => new UDim2(0.38 * swap(), 0, 0, 1)}
			/>
		</frame>
	);
}

/** The panel's big name, as in the planet panel. */
function NameLabel({ text, fade }: { readonly text: () => string; readonly fade: () => number }) {
	return (
		<textlabel
			BackgroundTransparency={1}
			FontFace={FONT_DISPLAY}
			Size={UDim2.fromScale(1, 0.085)}
			Text={text}
			TextColor3={COLORS.text}
			TextScaled={true}
			TextTransparency={fade}
			TextXAlignment={Enum.TextXAlignment.Left}
		>
			<uitextsizeconstraint MaxTextSize={26 * TEXT_SCALE} />
		</textlabel>
	);
}

/** The panel's description, under the name's underline. */
function Description({ text, fade }: { readonly text: string | (() => string); readonly fade: () => number }) {
	return (
		<textlabel
			BackgroundTransparency={1}
			FontFace={FONT}
			Size={UDim2.fromScale(1, 0.11)}
			Text={text}
			TextColor3={COLORS.muted}
			TextScaled={true}
			TextTransparency={fade}
			TextXAlignment={Enum.TextXAlignment.Left}
			TextYAlignment={Enum.TextYAlignment.Top}
		>
			<uitextsizeconstraint MaxTextSize={18 * TEXT_SCALE} />
		</textlabel>
	);
}

interface ResearchPanelProps {
	readonly picked: () => ResearchId | "core";
	readonly levels: () => Levels;
	readonly stateOf: (id: ResearchId) => NodeState;
	readonly reasonOf: (id: ResearchId) => string | undefined;
	readonly pool: () => ReadonlyArray<ResourceStack>;
	readonly onResearch: (id: ResearchId) => void;
	/** Turns false to slide it out. Return `$tuple(node, EXIT_TIME)` from the Show that renders it. */
	readonly show: () => boolean;
}

/**
 * The picked node, or the Core, on the right, like the planet panel on the
 * left of the star map: it slides in, and every pick and every research scans
 * it again and replays its details. A node's status chip, level, effect and
 * cost, with Research at the bottom; a locked node's under hazard stripes, and
 * a refused Research shakes. The Core's health, storage and team upgrades.
 */
function ResearchPanel({ picked, levels, stateOf, reasonOf, pool, onResearch, show }: ResearchPanelProps) {
	const slide = useAppear(show);
	const hovered = source(false);
	const [lift, liftSpring] = useSpring(0, SPRINGS.responsive);
	const [shake, shakeSpring] = useSpring(0, SHAKE);
	// 0-1, restarting with every pick: the fade of its details.
	const [swap, swapSpring] = useSpring(0, SPRINGS.smooth);
	effect(() => liftSpring.setGoal(hovered() ? 0.5 : 0));
	effect(() => {
		picked();
		swapSpring.setPosition(0);
		swapSpring.halt();
		swapSpring.setGoal(1);
	});

	const isCore = () => picked() === "core";
	/** The node on show, or the last one while the Core is: its half of the panel is hidden then. */
	const id = source<ResearchId>(RESEARCH_ORDER[0]);
	effect(() => {
		const current = picked();
		if (current !== "core") id(current);
	});
	const state = () => stateOf(id());
	const level = () => levels()[id()] ?? 0;
	const maxed = () => level() >= maxLevel(id());
	const cost = () => (maxed() ? [] : levelCost(id(), level()));
	const reason = () => reasonOf(id());
	const afford = () => canAfford(pool(), cost());
	const refused = () => reason() !== undefined || !afford();

	const [rawLock, lockSpring] = useSpring(0, SPRINGS.responsive);
	const [rawDone, doneSpring] = useSpring(0, SPRINGS.responsive);
	effect(() => {
		lockSpring.setGoal(!isCore() && state() === "locked" ? 1 : 0);
		doneSpring.setGoal(state() === "done" ? 1 : 0);
	});
	const lock = () => clamp01(rawLock());
	const fade = () => 1 - swap();
	/** The chip's brackets jump off the corners with every pick and settle back. */
	const flash = () => 0.3 + 0.7 * fade();
	const stagger = (row: number) => 0.05 + row * 0.05;
	/** A row's own 0-1, later for each row down the list, and restarting with every pick. */
	const reveal = (row: number) => {
		const appear = useAppear(show, stagger(row));
		return () => appear() * swap();
	};

	const name = useScramble("text", () => RESEARCH[id()].name.upper(), 0.1, 0.5);
	const coreName = useScramble("text", () => BUILDINGS.core.name.upper(), 0.1, 0.5);
	const heading = () => {
		const upgrade = RESEARCH[id()].effect;
		return upgrade ? STATS[upgrade.stat].name.upper() : "NEW BUILDING";
	};
	const effectText = () => {
		const node = RESEARCH[id()];
		if (node.unlocks !== undefined) return `+ ${BUILDINGS[node.unlocks].name.upper()}`;
		if (!node.effect) return "";
		const { stat } = node.effect;
		const now = formatStat(stat, statValue(levels(), stat));
		if (maxed()) return `${now}  MAX`;
		return `${now} → ${formatStat(stat, statValue({ ...levels(), [id()]: level() + 1 }, stat))}`;
	};
	const action = () => {
		if (maxed()) return "RESEARCHED";
		if (reason() !== undefined) return "LOCKED";
		return afford() ? "RESEARCH" : "NOT ENOUGH";
	};

	return (
		<frame
			Name="ResearchPanel"
			Active={true}
			AnchorPoint={new Vector2(1, 0)}
			BackgroundTransparency={1}
			Position={() => UDim2.fromScale(0.98 + 0.3 * (1 - slide()), 0.18)}
			Size={UDim2.fromScale(0.22, 0.62)}
			MouseEnter={() => hovered(true)}
			MouseLeave={() => hovered(false)}
		>
			{/* Every pick and every research sweeps the scan line down it again. */}
			<Panel
				lift={lift}
				rescan={() => {
					picked();
					return levels();
				}}
				square={true}
			>
				{/* A locked node's hazard stripes, behind everything. */}
				<frame
					BackgroundColor3={RED}
					BackgroundTransparency={() => 1 - lock()}
					BorderSizePixel={0}
					Size={UDim2.fromScale(1, 1)}
				>
					<uigradient Rotation={45} Transparency={STRIPES} />
				</frame>

				<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 1)}>
					<uipadding
						PaddingBottom={new UDim(0.04, 0)}
						PaddingLeft={new UDim(0.06, 0)}
						PaddingRight={new UDim(0.06, 0)}
						PaddingTop={new UDim(0.04, 0)}
					/>

					<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 1)} Visible={() => !isCore()}>
						<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 0.88)}>
							<uilistlayout Padding={new UDim(0.012, 0)} />
							<StatusChip
								textScale={TEXT_SCALE}
								label={() => STATE_NAMES[state()]}
								lock={lock}
								mission={() => clamp01(rawDone())}
								open={flash}
								palette={CHIP}
								reveal={reveal(0)}
							/>
							<NameLabel text={name} fade={fade} />
							<Underline progress={swap} color={() => AMBER.Lerp(RED, lock())} />
							<Description text={() => RESEARCH[id()].description} fade={fade} />
							<Heading text={heading} swap={swap} />
							<Row
								textScale={TEXT_SCALE}
								delay={stagger(1)}
								label="LEVEL"
								reveal={reveal(1)}
								value={() => `${level()} / ${maxLevel(id())}`}
							/>
							<Row
								textScale={TEXT_SCALE}
								color={() => BLUE}
								delay={stagger(2)}
								label="EFFECT"
								reveal={reveal(2)}
								value={effectText}
							/>
							<Row
								textScale={TEXT_SCALE}
								color={() => (isTeamNode(id()) ? AMBER : COLORS.text)}
								delay={stagger(3)}
								label="FOR"
								reveal={reveal(3)}
								value={() => (isTeamNode(id()) ? "WHOLE TEAM" : "YOU")}
							/>
							<Heading text={() => (maxed() ? "FULLY RESEARCHED" : "COST")} swap={swap} />
							<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 0.16)}>
								<uilistlayout SortOrder={Enum.SortOrder.LayoutOrder} />
								<Index each={cost}>
									{(stack, index) => {
										const have = () => amountOf(pool(), stack().resource);
										return (
											<frame
												BackgroundTransparency={1}
												LayoutOrder={index}
												Size={UDim2.fromScale(1, 1 / 3)}
											>
												<Swatch resource={() => stack().resource} />
												<textlabel
													BackgroundTransparency={1}
													FontFace={FONT_LABEL}
													Position={UDim2.fromOffset(16, 0)}
													Size={new UDim2(0.5, -16, 1, 0)}
													Text={() => RESOURCES[stack().resource].name.upper()}
													TextColor3={COLORS.muted}
													TextScaled={true}
													TextTransparency={fade}
													TextXAlignment={Enum.TextXAlignment.Left}
												>
													<uitextsizeconstraint MaxTextSize={13 * TEXT_SCALE} />
												</textlabel>
												<textlabel
													AnchorPoint={new Vector2(1, 0)}
													BackgroundTransparency={1}
													FontFace={FONT_DISPLAY}
													Position={UDim2.fromScale(1, 0)}
													Size={UDim2.fromScale(0.5, 1)}
													Text={() => `${have()} / ${stack().amount}`}
													TextColor3={() =>
														have() >= stack().amount ? COLORS.text : COLORS.danger
													}
													TextScaled={true}
													TextTransparency={fade}
													TextXAlignment={Enum.TextXAlignment.Right}
												>
													<uitextsizeconstraint MaxTextSize={15 * TEXT_SCALE} />
												</textlabel>
											</frame>
										);
									}}
								</Index>
							</frame>
							<textlabel
								BackgroundTransparency={1}
								FontFace={FONT_LABEL}
								Size={UDim2.fromScale(1, 0.05)}
								Text={() => {
									if (maxed()) return "";
									return reason()?.upper() ?? (afford() ? "" : "THE CORE IS SHORT");
								}}
								TextColor3={COLORS.danger}
								TextScaled={true}
								TextTransparency={fade}
								TextXAlignment={Enum.TextXAlignment.Left}
							>
								<uitextsizeconstraint MaxTextSize={13 * TEXT_SCALE} />
							</textlabel>
						</frame>

						<frame
							AnchorPoint={new Vector2(0, 1)}
							BackgroundTransparency={1}
							Position={() => new UDim2(0, shake(), 1, 0)}
							Size={UDim2.fromScale(1, 0.08)}
						>
							<Button
								color={BLUE}
								disabled={refused}
								onClick={() => onResearch(id())}
								size={UDim2.fromScale(1, 1)}
								text={action}
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

					<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 1)} Visible={isCore}>
						<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 0.88)}>
							<uilistlayout Padding={new UDim(0.012, 0)} />
							<StatusChip
								textScale={TEXT_SCALE}
								label={() => "CORE ONLINE"}
								lock={() => 0}
								mission={() => 1}
								open={flash}
								palette={CHIP}
								reveal={reveal(0)}
							/>
							<NameLabel text={coreName} fade={fade} />
							<Underline progress={swap} color={() => AMBER} />
							<Description
								text={`${BUILDINGS.core.description} Every branch of research starts here.`}
								fade={fade}
							/>
							<Heading text="STATUS" swap={swap} />
							<Row
								textScale={TEXT_SCALE}
								delay={stagger(1)}
								label="HEALTH"
								reveal={reveal(1)}
								value={() => formatStat("coreHealth", statValue(levels(), "coreHealth"))}
							/>
							<Row
								textScale={TEXT_SCALE}
								delay={stagger(2)}
								label="STORAGE"
								reveal={reveal(2)}
								value={() => `${formatStat("coreCapacity", statValue(levels(), "coreCapacity"))} EACH`}
							/>
							<Heading text="TEAM UPGRADES" swap={swap} />
							{TEAM_NODES.map((node, index) => (
								<Row
									textScale={TEXT_SCALE}
									color={() => ((levels()[node] ?? 0) > 0 ? AMBER : COLORS.muted)}
									delay={stagger(3 + index)}
									label={RESEARCH[node].name.upper()}
									reveal={reveal(3 + index)}
									value={() => `${levels()[node] ?? 0} / ${maxLevel(node)}`}
								/>
							))}
						</frame>
						<textlabel
							AnchorPoint={new Vector2(0, 1)}
							BackgroundTransparency={1}
							FontFace={FONT_LABEL}
							Position={UDim2.fromScale(0, 1)}
							Size={UDim2.fromScale(1, 0.05)}
							Text="ALL RESEARCH IS PAID FROM CORE STORAGE"
							TextColor3={COLORS.subtext}
							TextScaled={true}
							TextTransparency={fade}
							TextXAlignment={Enum.TextXAlignment.Left}
						>
							<uitextsizeconstraint MaxTextSize={12 * TEXT_SCALE} />
						</textlabel>
					</frame>
				</frame>
			</Panel>
		</frame>
	);
}

interface ResearchTreeProps {
	/** The local player's research, the team's included. */
	readonly levels: () => Levels;
	readonly gates: () => ResearchGates;
	/** The Core's pool, which research is paid from. */
	readonly pool: () => ReadonlyArray<ResourceStack>;
	readonly onResearch: (id: ResearchId) => void;
	readonly onClose: () => void;
	/** Turns false to fade it away. Return `$tuple(node, EXIT_TIME)` from the Show that renders it. */
	readonly show: () => boolean;
}

/**
 * The research tree, over the whole screen and the menu's backdrop: the Core
 * in the middle, building branches above and the rest below, every node wired
 * to what it needs. On opening, the tree grows out of the Core, its traces
 * drawing themselves out and its nodes popping in as they're reached. Then the
 * Core beats, sending a pulse out along every live trace that lights each
 * node it passes. Drag to pan, scroll to zoom. Clicking a node or the Core
 * locks a reticle onto it and slides its panel in on the right; clicking empty
 * space closes it. The Core's storage sits top left.
 * ponytail: no pinch zoom on touch; add it with UserInputService.TouchPinch if mobile players need it.
 */
export function ResearchTree({ levels, gates, pool, onResearch, onClose, show }: ResearchTreeProps) {
	const appear = useAppear(show);
	const slideIn = useAppear(show, 0.15);
	const hintIn = useAppear(show, 1.2);
	const opened = os.clock();
	/** Seconds since it opened. Every pulse and glitch below runs off it. */
	const now = source(0);
	cleanup(RunService.RenderStepped.Connect(() => now(os.clock() - opened)));
	/** Pixels along the traces from the Core that the tree has grown. */
	const [grown, growTween] = useTween(0, { duration: GROW_SECONDS, easing: "sineOut" });
	growTween.setGoal(FURTHEST);
	/** Pixels along the traces the Core's latest pulse has run, or -1 before the tree has grown. */
	const pulse = () => {
		const since = now() - GROW_SECONDS;
		return PULSING && since >= 0 ? (since * PULSE_SPEED) % CYCLE : -1;
	};
	/** 0-`PULSE_SHINE`: the glow `at` pixels from the Core, flaring as the pulse arrives and fading after it. */
	const glowAt = (at: number) => {
		const behind = pulse() - at;
		return behind >= 0 ? PULSE_SHINE * math.max(0, 1 - behind / (PULSE_SPEED * PULSE_GLOW)) : 0;
	};
	/** A spring that pops in once the tree has grown `at` pixels from the Core, and out as it closes. */
	const popAt = (at: number) => {
		const [value, spring] = useSpring(0, SPRINGS.bouncy);
		effect(() => spring.setGoal(show() && grown() >= at ? 1 : 0));
		return value;
	};

	const pan = source(Vector2.zero);
	const zoom = source(1);
	/** The node whose panel is open, or the Core's. */
	const selected = source<ResearchId | "core">();
	const pick = (picked: ResearchId | "core") => selected(selected() === picked ? undefined : picked);
	// Roblox's topbar covers the top of the screen, which this ScreenGui ignores the inset of.
	const [inset] = GuiService.GetGuiInset();
	const top = inset.Y + EDGE;

	const reasonOf = (id: ResearchId) => lockReason(id, levels(), gates());
	const stateOf = (id: ResearchId): NodeState => {
		if ((levels()[id] ?? 0) > 0) return "done";
		return reasonOf(id) === undefined ? "open" : "locked";
	};

	// The Core can't leave the screen, nor any node get further from the middle than the furthest one is from the Core.
	const clampPan = (value: Vector2) => {
		const limit = pixels(extent).mul(zoom());
		return new Vector2(math.clamp(value.X, -limit.X, limit.X), math.clamp(value.Y, -limit.Y, limit.Y));
	};
	/** Zooms by `factor`, keeping the canvas point under `screen` where it is. */
	const zoomAt = (screen: Vector2, factor: number) => {
		const from = zoom();
		const to = math.clamp(from * factor, ZOOM_MIN, ZOOM_MAX);
		const offset = screen.sub(Workspace.CurrentCamera!.ViewportSize.div(2));
		zoom(to);
		pan(clampPan(offset.sub(offset.sub(pan()).mul(to / from))));
	};

	let drag: { readonly from: Vector2; readonly pan: Vector2; moved: boolean } | undefined;
	const isPress = (input: InputObject) =>
		input.UserInputType === Enum.UserInputType.MouseButton1 || input.UserInputType === Enum.UserInputType.Touch;
	const connections = [
		UserInputService.InputChanged.Connect((input) => {
			if (input.UserInputType === Enum.UserInputType.MouseWheel) {
				zoomAt(UserInputService.GetMouseLocation(), input.Position.Z > 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
				return;
			}
			const moving =
				input.UserInputType === Enum.UserInputType.MouseMovement ||
				input.UserInputType === Enum.UserInputType.Touch;
			if (!drag || !moving) return;
			const delta = new Vector2(input.Position.X, input.Position.Y).sub(drag.from);
			if (delta.Magnitude > DRAG_SLOP) drag.moved = true;
			if (drag.moved) pan(clampPan(drag.pan.add(delta)));
		}),
		UserInputService.InputEnded.Connect((input) => {
			if (!drag || !isPress(input)) return;
			if (!drag.moved) selected(undefined);
			drag = undefined;
		}),
	];
	cleanup(() => connections.forEach((connection) => connection.Disconnect()));

	const hint = useScramble(
		"research",
		() => "DRAG  PAN   ·   SCROLL  ZOOM   ·   CLICK  INSPECT   ·   T  CLOSE",
		1.2,
		0.7,
	);

	return (
		<canvasgroup
			Name="ResearchTree"
			BackgroundTransparency={1}
			GroupTransparency={() => 1 - appear()}
			Size={UDim2.fromScale(1, 1)}
		>
			<MenuBackground />
			{/* Empty space: press and drag to pan, click to close the panel. It darkens the backdrop under the tree. */}
			<textbutton
				AutoButtonColor={false}
				BackgroundColor3={COLORS.card}
				BackgroundTransparency={0.3}
				Size={UDim2.fromScale(1, 1)}
				Text=""
				ZIndex={1}
				InputBegan={(input) => {
					if (isPress(input)) {
						drag = { from: new Vector2(input.Position.X, input.Position.Y), pan: pan(), moved: false };
					}
				}}
			/>
			{/* Over the backdrop, not in it, so pressing a node never starts a pan. Zero-sized: its origin is the Core. */}
			<frame
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Position={() => new UDim2(0.5, pan().X, 0.5, pan().Y)}
				Size={UDim2.fromOffset(0, 0)}
				ZIndex={2}
			>
				<uiscale Scale={() => zoom() * (0.92 + 0.08 * appear())} />
				{TRACES.map((trace) => (
					<TraceLine trace={trace} state={() => stateOf(trace.to)} grown={grown} pulse={pulse} />
				))}
				<Tile
					at={Vector2.zero}
					size={CORE_NODE}
					color={() => AMBER}
					energy={() => AMBER.Lerp(COLORS.text, 0.45)}
					pop={popAt(0)}
					glow={() => glowAt(0)}
					selected={() => selected() === "core"}
					onClick={() => pick("core")}
					content={(fill) => (
						<>
							<IconSlot>
								<Glyph glyph="core" color={AMBER} background={fill} />
							</IconSlot>
							<textlabel
								AnchorPoint={new Vector2(0.5, 0)}
								BackgroundTransparency={1}
								FontFace={FONT_DISPLAY}
								Position={new UDim2(0.5, 0, 1, STROKE + 6)}
								Size={UDim2.fromOffset(100, 14)}
								Text="CORE"
								TextColor3={AMBER}
								TextSize={13}
								ZIndex={4}
							/>
						</>
					)}
				/>
				{RESEARCH_ORDER.map((id) => (
					<NodeButton
						id={id}
						level={() => levels()[id] ?? 0}
						state={() => stateOf(id)}
						selected={() => selected() === id}
						pop={popAt(reachOf(id))}
						pulse={() => (stateOf(id) === "locked" ? 0 : glowAt(reachOf(id)))}
						onClick={() => pick(id)}
					/>
				))}
				<Reticle
					target={() => {
						const picked = selected();
						if (picked === undefined) return undefined;
						if (picked === "core") return { at: Vector2.zero, size: CORE_NODE, color: AMBER };
						return { at: pixels(POSITIONS.get(picked)!), size: NODE, color: STATE_COLORS[stateOf(picked)] };
					}}
				/>
			</frame>

			{/* The HUD over the tree. Not Active, so the empty space in it still pans. */}
			<frame BackgroundTransparency={1} Size={UDim2.fromScale(1, 1)} ZIndex={3}>
				<TreeTitle now={now} top={top} />

				<HudBox
					name="CoreStorage"
					anchorPoint={Vector2.zero}
					position={() => UDim2.fromOffset(EDGE - 260 * (1 - slideIn()), top)}
					size={() => UDim2.fromOffset(210, 40 + 20 * pool().size())}
				>
					<Label text={useScramble("hud", () => "CORE STORAGE", 0.2)} size={new UDim2(1, 0, 0, 14)} />
					<frame BackgroundTransparency={1} Position={UDim2.fromOffset(0, 22)} Size={new UDim2(1, 0, 1, -22)}>
						<uilistlayout Padding={new UDim(0, 4)} SortOrder={Enum.SortOrder.LayoutOrder} />
						<Index each={pool}>
							{(stack, index) => (
								<frame BackgroundTransparency={1} LayoutOrder={index} Size={new UDim2(1, 0, 0, 16)}>
									<Swatch resource={() => stack().resource} />
									<Label
										position={UDim2.fromOffset(16, 0)}
										size={new UDim2(0.6, -16, 1, 0)}
										text={() => RESOURCES[stack().resource].name.upper()}
									/>
									{/* Decodes again whenever it changes, as research spends it. */}
									<Label
										alignX={Enum.TextXAlignment.Right}
										anchorPoint={new Vector2(1, 0)}
										color={COLORS.text}
										font={FONT_DISPLAY}
										position={UDim2.fromScale(1, 0)}
										size={UDim2.fromScale(0.4, 1)}
										text={useScramble("hud", () => tostring(stack().amount), 0, 0.25)}
										textSize={14}
									/>
								</frame>
							)}
						</Index>
					</frame>
				</HudBox>

				<HudBox
					name="Legend"
					anchorPoint={new Vector2(0, 1)}
					position={() => new UDim2(0, EDGE - 220 * (1 - slideIn()), 1, -EDGE)}
					size={UDim2.fromOffset(170, 74)}
				>
					<uilistlayout Padding={new UDim(0, 4)} SortOrder={Enum.SortOrder.LayoutOrder} />
					{(["done", "open", "locked"] as const).map((state, index) => (
						<frame BackgroundTransparency={1} LayoutOrder={index} Size={new UDim2(1, 0, 0, 16)}>
							<frame
								AnchorPoint={new Vector2(0, 0.5)}
								BackgroundColor3={STATE_COLORS[state]}
								BorderSizePixel={0}
								Position={UDim2.fromScale(0, 0.5)}
								Size={UDim2.fromOffset(10, 10)}
							/>
							<Label
								position={UDim2.fromOffset(18, 0)}
								size={new UDim2(1, -18, 1, 0)}
								text={STATE_NAMES[state]}
								textSize={12}
							/>
						</frame>
					))}
				</HudBox>

				<textlabel
					AnchorPoint={new Vector2(1, 1)}
					BackgroundTransparency={1}
					FontFace={FONT_LABEL}
					Position={() => new UDim2(0.98, 0, 0.97, 12 * (1 - hintIn()))}
					Size={UDim2.fromScale(0.6, 0.025)}
					Text={hint}
					TextColor3={COLORS.muted}
					TextScaled={true}
					TextTransparency={() => 1 - 0.8 * hintIn()}
					TextXAlignment={Enum.TextXAlignment.Right}
				>
					<uitextsizeconstraint MaxTextSize={14} />
				</textlabel>

				<Button
					anchorPoint={new Vector2(0.5, 1)}
					color={COLORS.stroke}
					onClick={onClose}
					position={new UDim2(0.5, 0, 1, -EDGE)}
					size={UDim2.fromOffset(200, 42)}
					text="BACK"
				/>

				<Show when={selected}>
					{(picked, shown) =>
						$tuple(
							<ResearchPanel
								picked={picked}
								levels={levels}
								stateOf={stateOf}
								reasonOf={reasonOf}
								pool={pool}
								onResearch={onResearch}
								show={shown}
							/>,
							EXIT_TIME,
						)
					}
				</Show>
			</frame>
		</canvasgroup>
	);
}
