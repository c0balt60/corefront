import Vide, { cleanup, effect, For, Index, Show, source } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Button } from "core/Interface/client/components/button";
import { Brackets, ScanSweep } from "core/Interface/client/components/hud";
import { Shadow } from "core/Interface/client/components/shadow";
import { EXIT_TIME, useAppear, useScramble, useSpin } from "core/Interface/client/motion";
import { CARD_TRANSPARENCY, COLORS, FONT, FONT_DISPLAY, FONT_LABEL, SPRINGS } from "core/Interface/client/theme";
import { useServerTime } from "core/Interface/client/use-server-time";
import { type Inventory, NOTICE_SECONDS, type Notice } from "game/Base/client/base-state";
import { AIR_ALIENS, type AlienKind, type BaseState, GROUND_ALIENS } from "game/Base/shared/base-network";
import { type ResourceId, RESOURCES } from "game/Base/shared/resources";

const clamp01 = (value: number) => math.clamp(value, 0, 1);

/** Pixels between the HUD and the screen's edges. */
const EDGE = 16;

/** `seconds` as m:ss, never below 0:00. */
function clock(seconds: number) {
	const whole = math.max(0, math.ceil(seconds));
	return string.format("%d:%02d", math.floor(whole / 60), whole % 60);
}

interface LabelProps {
	readonly text: string | (() => string);
	readonly font?: Font;
	readonly textSize?: number;
	readonly color?: Color3 | (() => Color3);
	readonly alignX?: Enum.TextXAlignment;
	readonly anchorPoint?: Vector2;
	readonly position?: UDim2;
	readonly size: UDim2;
	readonly layoutOrder?: number;
	/** Wraps onto more lines instead of cutting off. */
	readonly wrapped?: boolean;
}

/** One line of HUD text at a fixed pixel size. Muted label type unless told otherwise. */
export function Label({
	text,
	font = FONT_LABEL,
	textSize = 13,
	color = COLORS.muted,
	alignX = Enum.TextXAlignment.Left,
	anchorPoint,
	position,
	size,
	layoutOrder,
	wrapped = false,
}: LabelProps) {
	return (
		<textlabel
			AnchorPoint={anchorPoint}
			BackgroundTransparency={1}
			FontFace={font}
			LayoutOrder={layoutOrder}
			Position={position}
			Size={size}
			Text={text}
			TextColor3={color}
			TextSize={textSize}
			TextTruncate={Enum.TextTruncate.AtEnd}
			TextWrapped={wrapped}
			TextXAlignment={alignX}
		/>
	);
}

interface HudBoxProps {
	readonly name: string;
	readonly anchorPoint: Vector2;
	readonly position: () => UDim2;
	readonly size: UDim2 | (() => UDim2);
	readonly children?: Vide.Node;
}

/**
 * A dark, square-cornered readout with a thin mitred outline and a drop shadow.
 * Its corner brackets snap on as it mounts. Children go inside its padding.
 */
export function HudBox({ name, anchorPoint, position, size, children }: HudBoxProps) {
	const [snap, snapSpring] = useSpring(1.8, SPRINGS.bouncy);
	snapSpring.setGoal(0);

	// Active, so a click on a readout doesn't also build behind it.
	return (
		<frame
			Name={name}
			Active={true}
			AnchorPoint={anchorPoint}
			BackgroundTransparency={1}
			Position={position}
			Size={size}
		>
			<Shadow lift={() => 0} scale={0.6} />
			<frame
				BackgroundColor3={COLORS.card}
				BackgroundTransparency={CARD_TRANSPARENCY}
				BorderSizePixel={0}
				Size={UDim2.fromScale(1, 1)}
				ZIndex={1}
			>
				<uistroke Color={COLORS.stroke} LineJoinMode={Enum.LineJoinMode.Miter} Thickness={1} />
				<uipadding
					PaddingBottom={new UDim(0, 10)}
					PaddingLeft={new UDim(0, 12)}
					PaddingRight={new UDim(0, 12)}
					PaddingTop={new UDim(0, 8)}
				/>
				{children}
			</frame>
			<Brackets kind="hud" open={snap} length={10} thickness={1.5} />
		</frame>
	);
}

/** A resource's colour, as a small square, centred down the left of its parent (or placed by a layout). */
export function Swatch({ resource }: { readonly resource: () => ResourceId }) {
	return (
		<frame
			BackgroundColor3={() => RESOURCES[resource()].color}
			BorderSizePixel={0}
			LayoutOrder={0}
			Position={new UDim2(0, 0, 0.5, -5)}
			Size={UDim2.fromOffset(10, 10)}
		>
			<uistroke Color={COLORS.stroke} LineJoinMode={Enum.LineJoinMode.Miter} Thickness={1} />
		</frame>
	);
}

interface MissionProps {
	readonly state: () => BaseState;
	/** Turns false to slide it away. Return `$tuple(node, EXIT_TIME)` from the Show that renders it. */
	readonly show: () => boolean;
}

interface WavePanelProps extends MissionProps {
	readonly onCallWave: () => void;
}

/**
 * Waves, on the right: how many have launched, a countdown to the next, how
 * many aliens are alive, and a button to launch the next wave now while one is
 * left. Slides in from the right.
 */
export function WavePanel({ state, show, onCallWave }: WavePanelProps) {
	const slide = useAppear(show, 0.1);
	const now = useServerTime();
	const status = () => {
		const { phase, nextWaveAt, aliens, wave, waves, liberated } = state();
		if (phase === "generating") return "GENERATING TERRAIN...";
		if (phase === "travelling") return "IN TRANSIT";
		if (liberated) return "PLANET LIBERATED";
		if (nextWaveAt > 0) return `NEXT WAVE IN ${clock(nextWaveAt - now())}`;
		if (aliens > 0) return "ALIENS ATTACKING";
		return wave >= waves ? "FINAL WAVE" : "STANDING BY";
	};
	const attacking = () => state().aliens > 0;

	return (
		<HudBox
			name="WavePanel"
			anchorPoint={new Vector2(1, 0)}
			position={() => new UDim2(1, -EDGE + 280 * (1 - slide()), 0.3, 0)}
			size={UDim2.fromOffset(220, 132)}
		>
			<Label text={useScramble("hud", () => "WAVE", 0.25)} size={new UDim2(1, 0, 0, 14)} />
			<Label
				color={COLORS.text}
				font={FONT_DISPLAY}
				position={UDim2.fromOffset(0, 14)}
				size={new UDim2(1, 0, 0, 30)}
				text={() => `${state().wave} / ${state().waves}`}
				textSize={28}
			/>
			<Label
				color={() => (attacking() && state().nextWaveAt === 0 ? COLORS.danger : COLORS.muted)}
				position={UDim2.fromOffset(0, 46)}
				size={new UDim2(1, 0, 0, 14)}
				text={status}
			/>
			<Label position={UDim2.fromOffset(0, 64)} size={new UDim2(0.5, 0, 0, 16)} text="ALIENS" />
			<Label
				alignX={Enum.TextXAlignment.Right}
				anchorPoint={new Vector2(1, 0)}
				color={() => (attacking() ? COLORS.danger : COLORS.text)}
				font={FONT_DISPLAY}
				position={new UDim2(1, 0, 0, 64)}
				size={new UDim2(0.5, 0, 0, 16)}
				text={() => tostring(state().aliens)}
				textSize={16}
			/>
			<Show when={() => state().phase === "active" && state().wave < state().waves}>
				{() => (
					<Button
						anchorPoint={new Vector2(0, 1)}
						color={COLORS.danger}
						onClick={onCallWave}
						position={UDim2.fromScale(0, 1)}
						size={new UDim2(1, 0, 0, 28)}
						text="CALL WAVE"
					/>
				)}
			</Show>
		</HudBox>
	);
}

/** How many aliens the sandbox panel can send at once. */
const SPAWN_COUNTS = [1, 5, 10, 25];
/** The sandbox panel's alien kinds, under their headings, this many chips to a row. */
const KIND_SECTIONS: ReadonlyArray<{ readonly name: string; readonly kinds: ReadonlyArray<AlienKind> }> = [
	{ name: "GROUND", kinds: GROUND_ALIENS },
	{ name: "AIR", kinds: AIR_ALIENS },
];
const KIND_COLUMNS = 3;
/** Pixels: a chip's height and the gap between chips, a section's heading, the gap between the panel's rows, and the COUNT label's width. */
const CHIP_HEIGHT = 26;
const CHIP_GAP = 6;
const HEADING = 18;
const ROW_GAP = 10;
const COUNT_LABEL = 56;

/** How tall a section of `count` chips is, heading and all. */
function sectionHeight(count: number): number {
	const rows = math.ceil(count / KIND_COLUMNS);
	return HEADING + rows * CHIP_HEIGHT + (rows - 1) * CHIP_GAP;
}

/** The sandbox panel's rows, in pixels: its title, the sections and the counts. The buttons go under them. */
const SANDBOX_ROWS =
	16 +
	KIND_SECTIONS.reduce((sum, { kinds }) => sum + sectionHeight(kinds.size()), 0) +
	CHIP_HEIGHT +
	ROW_GAP * (KIND_SECTIONS.size() + 1);
/** Its padding, the rows, and the buttons. */
const SANDBOX_HEIGHT = 18 + SANDBOX_ROWS + ROW_GAP + 28;

interface ChipProps {
	readonly text: string;
	/** Lit while true. */
	readonly picked: () => boolean;
	/** How many share its row, so it takes its share of the width. Left out in a grid, which sizes it. */
	readonly of?: number;
	readonly layoutOrder: number;
	readonly onClick: () => void;
}

/** One of a row of choices, lit in the accent while it's the one picked. */
function Chip({ text, picked, of, layoutOrder, onClick }: ChipProps) {
	return (
		<textbutton
			AutoButtonColor={true}
			BackgroundColor3={() => (picked() ? COLORS.accent : COLORS.disabled)}
			BorderSizePixel={0}
			FontFace={FONT_DISPLAY}
			LayoutOrder={layoutOrder}
			Size={of !== undefined ? new UDim2(1 / of, (-CHIP_GAP * (of - 1)) / of, 1, 0) : undefined}
			Text={text}
			TextColor3={() => (picked() ? COLORS.text : COLORS.subtext)}
			TextSize={13}
			Activated={onClick}
		>
			<uistroke
				ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
				Color={() => (picked() ? COLORS.text : COLORS.stroke)}
				LineJoinMode={Enum.LineJoinMode.Miter}
				Thickness={1}
			/>
		</textbutton>
	);
}

interface SandboxPanelProps extends MissionProps {
	/** Sends `count` aliens of `kind` from the drop zones. */
	readonly onSpawn: (kind: AlienKind, count: number) => void;
	/** Kills every alien. */
	readonly onClear: () => void;
}

/**
 * A sandbox's stand-in for the wave panel, on the right: how many aliens are alive, a kind to pick
 * from the ground and air sections and a count, and buttons to send them from the drop zones or
 * clear them all. Slides in from the right.
 */
export function SandboxPanel({ state, show, onSpawn, onClear }: SandboxPanelProps) {
	const slide = useAppear(show, 0.1);
	const kind = source<AlienKind>("crawler");
	const count = source(SPAWN_COUNTS[1]);
	const idle = () => state().phase !== "active";

	return (
		<HudBox
			name="SandboxPanel"
			anchorPoint={new Vector2(1, 0)}
			position={() => new UDim2(1, -EDGE + 340 * (1 - slide()), 0.3, 0)}
			size={UDim2.fromOffset(300, SANDBOX_HEIGHT)}
		>
			<frame BackgroundTransparency={1} Size={new UDim2(1, 0, 0, SANDBOX_ROWS)}>
				<uilistlayout Padding={new UDim(0, ROW_GAP)} SortOrder={Enum.SortOrder.LayoutOrder} />
				<frame BackgroundTransparency={1} LayoutOrder={0} Size={new UDim2(1, 0, 0, 16)}>
					<Label text={useScramble("hud", () => "SANDBOX", 0.25)} size={UDim2.fromScale(0.5, 1)} />
					<Label
						alignX={Enum.TextXAlignment.Right}
						anchorPoint={new Vector2(1, 0)}
						position={new UDim2(1, -40, 0, 0)}
						size={UDim2.fromScale(0.4, 1)}
						text="ALIENS"
					/>
					<Label
						alignX={Enum.TextXAlignment.Right}
						anchorPoint={new Vector2(1, 0)}
						color={() => (state().aliens > 0 ? COLORS.danger : COLORS.text)}
						font={FONT_DISPLAY}
						position={UDim2.fromScale(1, 0)}
						size={new UDim2(0, 36, 1, 0)}
						text={() => tostring(state().aliens)}
						textSize={16}
					/>
				</frame>
				{KIND_SECTIONS.map(({ name, kinds }, index) => (
					<frame
						BackgroundTransparency={1}
						LayoutOrder={index + 1}
						Size={new UDim2(1, 0, 0, sectionHeight(kinds.size()))}
					>
						<Label size={new UDim2(1, 0, 0, 12)} text={name} textSize={11} />
						<frame
							BackgroundTransparency={1}
							Position={UDim2.fromOffset(0, HEADING)}
							Size={new UDim2(1, 0, 1, -HEADING)}
						>
							<uigridlayout
								CellPadding={UDim2.fromOffset(CHIP_GAP, CHIP_GAP)}
								CellSize={
									new UDim2(
										1 / KIND_COLUMNS,
										(-CHIP_GAP * (KIND_COLUMNS - 1)) / KIND_COLUMNS,
										0,
										CHIP_HEIGHT,
									)
								}
								SortOrder={Enum.SortOrder.LayoutOrder}
							/>
							{kinds.map((option, order) => (
								<Chip
									text={option.upper()}
									picked={() => kind() === option}
									layoutOrder={order}
									onClick={() => kind(option)}
								/>
							))}
						</frame>
					</frame>
				))}
				<frame
					BackgroundTransparency={1}
					LayoutOrder={KIND_SECTIONS.size() + 1}
					Size={new UDim2(1, 0, 0, CHIP_HEIGHT)}
				>
					<Label size={new UDim2(0, COUNT_LABEL, 1, 0)} text="COUNT" />
					<frame
						BackgroundTransparency={1}
						Position={UDim2.fromOffset(COUNT_LABEL, 0)}
						Size={new UDim2(1, -COUNT_LABEL, 1, 0)}
					>
						<uilistlayout
							FillDirection={Enum.FillDirection.Horizontal}
							Padding={new UDim(0, CHIP_GAP)}
							SortOrder={Enum.SortOrder.LayoutOrder}
						/>
						{SPAWN_COUNTS.map((option, index) => (
							<Chip
								text={`x${option}`}
								picked={() => count() === option}
								of={SPAWN_COUNTS.size()}
								layoutOrder={index}
								onClick={() => count(option)}
							/>
						))}
					</frame>
				</frame>
			</frame>
			<Button
				anchorPoint={new Vector2(0, 1)}
				color={COLORS.danger}
				disabled={idle}
				onClick={() => onSpawn(kind(), count())}
				position={UDim2.fromScale(0, 1)}
				size={new UDim2(0.6, -CHIP_GAP / 2, 0, 28)}
				text="SPAWN"
			/>
			<Button
				anchorPoint={new Vector2(1, 1)}
				color={COLORS.stroke}
				disabled={idle}
				onClick={onClear}
				position={UDim2.fromScale(1, 1)}
				size={new UDim2(0.4, -CHIP_GAP / 2, 0, 28)}
				text="CLEAR"
			/>
		</HudBox>
	);
}

/** A cargo row's drop button's width and height, in pixels. */
const DROP = 16;

/** A small X at the right of a cargo row, red while hovered. */
function DropButton({ onDrop }: { readonly onDrop: () => void }) {
	const hovered = source(false);
	return (
		<textbutton
			AnchorPoint={new Vector2(1, 0.5)}
			BackgroundTransparency={1}
			FontFace={FONT_DISPLAY}
			Position={UDim2.fromScale(1, 0.5)}
			Size={UDim2.fromOffset(DROP, DROP)}
			Text="X"
			TextColor3={() => (hovered() ? COLORS.danger : COLORS.subtext)}
			TextSize={13}
			Activated={onDrop}
			MouseEnter={() => hovered(true)}
			MouseLeave={() => hovered(false)}
		/>
	);
}

interface CargoPanelProps {
	readonly inventory: () => Inventory;
	readonly show: () => boolean;
	/** Throws away all of a resource carried. */
	readonly onDrop: (resource: ResourceId) => void;
}

/**
 * What the local player carries, bottom left: the total against the capacity
 * with a bar that turns accent when full, and a row for each resource carried,
 * with an X that throws it all away. Slides in from the left.
 */
export function CargoPanel({ inventory, show, onDrop }: CargoPanelProps) {
	const slide = useAppear(show, 0.15);
	const total = () => inventory().items.reduce((sum, stack) => sum + stack.amount, 0);
	const full = () => clamp01(total() / math.max(inventory().capacity, 1));
	const [fill, fillSpring] = useSpring(full(), SPRINGS.responsive);
	effect(() => fillSpring.setGoal(full()));

	return (
		<HudBox
			name="Cargo"
			anchorPoint={new Vector2(0, 1)}
			position={() => new UDim2(0, EDGE - 280 * (1 - slide()), 1, -EDGE)}
			size={() => UDim2.fromOffset(220, 52 + 20 * inventory().items.size())}
		>
			<Label text={useScramble("hud", () => "CARGO", 0.3)} size={new UDim2(0.5, 0, 0, 14)} />
			<Label
				alignX={Enum.TextXAlignment.Right}
				anchorPoint={new Vector2(1, 0)}
				color={() => (full() >= 1 ? COLORS.accent : COLORS.text)}
				font={FONT_DISPLAY}
				position={UDim2.fromScale(1, 0)}
				size={new UDim2(0.5, 0, 0, 14)}
				text={() => `${total()} / ${inventory().capacity}`}
				textSize={14}
			/>
			<frame
				BackgroundColor3={COLORS.disabled}
				BackgroundTransparency={0.4}
				BorderSizePixel={0}
				Position={UDim2.fromOffset(0, 20)}
				Size={new UDim2(1, 0, 0, 6)}
			>
				<frame
					BackgroundColor3={() => (full() >= 1 ? COLORS.accent : COLORS.text)}
					BorderSizePixel={0}
					Size={() => UDim2.fromScale(clamp01(fill()), 1)}
				/>
			</frame>
			<frame BackgroundTransparency={1} Position={UDim2.fromOffset(0, 34)} Size={new UDim2(1, 0, 1, -34)}>
				<uilistlayout Padding={new UDim(0, 4)} SortOrder={Enum.SortOrder.LayoutOrder} />
				<Index each={() => inventory().items}>
					{(stack, index) => (
						<frame BackgroundTransparency={1} LayoutOrder={index} Size={new UDim2(1, 0, 0, 16)}>
							<Swatch resource={() => stack().resource} />
							<Label
								position={UDim2.fromOffset(16, 0)}
								size={new UDim2(0.7, -16, 1, 0)}
								text={() => RESOURCES[stack().resource].name.upper()}
							/>
							<Label
								alignX={Enum.TextXAlignment.Right}
								anchorPoint={new Vector2(1, 0)}
								color={COLORS.text}
								font={FONT_DISPLAY}
								position={new UDim2(1, -DROP - 6, 0, 0)}
								size={UDim2.fromScale(0.3, 1)}
								text={() => tostring(stack().amount)}
								textSize={14}
							/>
							<DropButton onDrop={() => onDrop(stack().resource)} />
						</frame>
					)}
				</Index>
			</frame>
		</HudBox>
	);
}

/** One toast. It pops in, decodes, and fades out just before `NOTICE_SECONDS` are up and the controller drops it. */
function Toast({ text, layoutOrder }: { readonly text: string; readonly layoutOrder: () => number }) {
	const shown = source(true);
	cleanup(task.delay(NOTICE_SECONDS - EXIT_TIME, () => shown(false)));
	const appear = useAppear(shown, 0, SPRINGS.responsive);
	const fade = () => 1 - clamp01(appear());

	return (
		<frame
			BackgroundColor3={COLORS.card}
			BackgroundTransparency={() => 1 - 0.6 * clamp01(appear())}
			BorderSizePixel={0}
			LayoutOrder={layoutOrder}
			Size={UDim2.fromOffset(420, 30)}
		>
			<uiscale Scale={() => 0.92 + 0.08 * appear()} />
			<frame
				BackgroundColor3={COLORS.accent}
				BackgroundTransparency={fade}
				BorderSizePixel={0}
				Size={new UDim2(0, 3, 1, 0)}
			/>
			<textlabel
				BackgroundTransparency={1}
				FontFace={FONT}
				Position={UDim2.fromOffset(14, 0)}
				Size={new UDim2(1, -28, 1, 0)}
				Text={useScramble("hud", () => text, 0, 0.3)}
				TextColor3={COLORS.text}
				TextSize={17}
				TextTransparency={fade}
				TextTruncate={Enum.TextTruncate.AtEnd}
			/>
		</frame>
	);
}

/**
 * Over the toasts while the Core is being hit: CORE UNDER ATTACK, its text and outline beating
 * between white and red. Pops in and fades out.
 */
export function CoreWarning({ show }: { readonly show: () => boolean }) {
	const appear = useAppear(show, 0, SPRINGS.bouncy);
	const shown = () => clamp01(appear());
	const spin = useSpin(() => 360);
	const beat = () => 0.5 + 0.5 * math.sin(math.rad(spin()));

	return (
		<frame
			Name="CoreWarning"
			BackgroundColor3={COLORS.card}
			BackgroundTransparency={() => 1 - 0.6 * shown()}
			BorderSizePixel={0}
			// Above the toasts, which count up from 0.
			LayoutOrder={-1}
			Size={UDim2.fromOffset(420, 40)}
		>
			<uiscale Scale={() => 0.9 + 0.1 * appear()} />
			<uistroke
				Color={COLORS.danger}
				LineJoinMode={Enum.LineJoinMode.Miter}
				Thickness={1.5}
				Transparency={() => 1 - shown() * (0.3 + 0.7 * beat())}
			/>
			<textlabel
				BackgroundTransparency={1}
				FontFace={FONT_DISPLAY}
				Size={UDim2.fromScale(1, 1)}
				Text={useScramble("hud", () => "CORE UNDER ATTACK", 0, 0.3)}
				TextColor3={() => COLORS.text.Lerp(COLORS.danger, beat())}
				TextSize={20}
				TextTransparency={() => 1 - shown()}
			/>
		</frame>
	);
}

/** The server's toasts, stacked top centre, newest at the bottom, under `children`: warnings that outrank them. */
export function Notices({
	notices,
	children,
}: {
	readonly notices: () => ReadonlyArray<Notice>;
	readonly children?: Vide.Node;
}) {
	return (
		<frame
			Name="Notices"
			AnchorPoint={new Vector2(0.5, 0)}
			BackgroundTransparency={1}
			Position={new UDim2(0.5, 0, 0, EDGE)}
			Size={UDim2.fromOffset(420, 200)}
		>
			<uilistlayout
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				Padding={new UDim(0, 6)}
				SortOrder={Enum.SortOrder.LayoutOrder}
			/>
			{children}
			<For each={notices}>{(notice, index) => <Toast text={notice.text} layoutOrder={index} />}</For>
		</frame>
	);
}

interface ResultBannerProps {
	readonly result: () => "won" | "lost";
	/** Turns false to close the band. Return `$tuple(node, EXIT_TIME)` from the Show that renders it. */
	readonly show: () => boolean;
}

/**
 * The end of the mission: a band opens across the screen with PLANET LIBERATED
 * in green or CORE DESTROYED in red, decoding under a caption while brackets
 * close in round it and a scan line runs down the band.
 */
export function ResultBanner({ result, show }: ResultBannerProps) {
	const open = useAppear(show);
	const pop = useAppear(show, 0.1, SPRINGS.bouncy);
	const shown = () => clamp01(open());
	// A banner never changes sides: the Show remounts it for a new result.
	const won = result() === "won";
	const color = won ? COLORS.confirm : COLORS.danger;

	return (
		<frame
			Name="ResultBanner"
			AnchorPoint={new Vector2(0.5, 0.5)}
			BackgroundColor3={COLORS.card}
			BackgroundTransparency={() => 1 - 0.5 * shown()}
			BorderSizePixel={0}
			ClipsDescendants={true}
			Position={UDim2.fromScale(0.5, 0.4)}
			Size={() => new UDim2(1, 0, 0, 170 * shown())}
			ZIndex={5}
		>
			<frame BackgroundColor3={color} BorderSizePixel={0} Size={new UDim2(1, 0, 0, 2)} />
			<frame
				AnchorPoint={new Vector2(0, 1)}
				BackgroundColor3={color}
				BorderSizePixel={0}
				Position={UDim2.fromScale(0, 1)}
				Size={new UDim2(1, 0, 0, 2)}
			/>
			<frame
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(0.5, 0.5)}
				Size={UDim2.fromOffset(760, 120)}
			>
				<uiscale Scale={() => 0.85 + 0.15 * pop()} />
				<Label
					alignX={Enum.TextXAlignment.Center}
					color={color}
					size={new UDim2(1, 0, 0, 24)}
					text={useScramble("banner", () => (won ? "MISSION COMPLETE" : "MISSION FAILED"), 0.05, 0.4)}
					textSize={18}
				/>
				<textlabel
					BackgroundTransparency={1}
					FontFace={FONT_DISPLAY}
					Position={UDim2.fromOffset(0, 30)}
					Size={new UDim2(1, 0, 0, 80)}
					Text={useScramble("banner", () => (won ? "PLANET LIBERATED" : "CORE DESTROYED"), 0.15, 0.6)}
					TextColor3={COLORS.text}
					TextScaled={true}
				/>
				<Brackets kind="banner" color={color} open={() => 1 - shown()} length={24} visibility={shown} />
			</frame>
			<ScanSweep kind="banner" color={color} duration={1.2} zIndex={6} />
		</frame>
	);
}
