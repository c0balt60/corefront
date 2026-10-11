import Vide, { cleanup, effect, For, Index, Show, source } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Button } from "core/Interface/client/components/button";
import { Brackets, ScanSweep } from "core/Interface/client/components/hud";
import { Shadow } from "core/Interface/client/components/shadow";
import { EXIT_TIME, useAppear, useScramble } from "core/Interface/client/motion";
import { CARD_TRANSPARENCY, COLORS, FONT, FONT_DISPLAY, FONT_LABEL, SPRINGS } from "core/Interface/client/theme";
import { useServerTime } from "core/Interface/client/use-server-time";
import { type Inventory, NOTICE_SECONDS, type Notice } from "game/Base/client/base-state";
import type { BaseState } from "game/Base/shared/base-network";
import { type ResourceId, RESOURCES } from "game/Base/shared/resources";

const clamp01 = (value: number) => math.clamp(value, 0, 1);

/** Slower than any `SPRINGS` preset, so the trail behind the core's health bar lingers long enough to show a hit. */
const TRAIL = { tension: 40, friction: 14 };
/** Pixels between the HUD and the screen's edges. */
const EDGE = 16;
/** Pixels between the top of the screen (below Roblox's topbar) and the Core's readout. */
const TOP = EDGE;

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

/**
 * The Core, top centre: its health as a bar that springs
 * to each new value, green to red as it falls, with a pale trail that drains
 * after it on every hit. Under it, a swatch and count for each resource the core
 * holds. Drops in from the top.
 */
export function CoreStatus({ state, show }: MissionProps) {
	const drop = useAppear(show, 0.05);
	const health = () => {
		const { coreHealth, coreMaxHealth } = state();
		return coreMaxHealth > 0 ? clamp01(coreHealth / coreMaxHealth) : 0;
	};
	const [fill, fillSpring] = useSpring(health(), SPRINGS.responsive);
	const [trail, trailSpring] = useSpring(health(), TRAIL);
	effect(() => {
		fillSpring.setGoal(health());
		trailSpring.setGoal(health());
	});

	return (
		<HudBox
			name="CoreStatus"
			anchorPoint={new Vector2(0.5, 0)}
			position={() => new UDim2(0.5, 0, 0, TOP - 160 * (1 - drop()))}
			size={UDim2.fromOffset(360, 74)}
		>
			<Label text={useScramble("hud", () => "CORE", 0.2)} size={new UDim2(0.5, 0, 0, 14)} />
			<Label
				alignX={Enum.TextXAlignment.Right}
				anchorPoint={new Vector2(1, 0)}
				color={COLORS.text}
				font={FONT_DISPLAY}
				position={UDim2.fromScale(1, 0)}
				size={new UDim2(0.5, 0, 0, 14)}
				text={() => `${math.ceil(state().coreHealth)} / ${state().coreMaxHealth}`}
				textSize={14}
			/>
			<frame
				BackgroundColor3={COLORS.disabled}
				BackgroundTransparency={0.4}
				BorderSizePixel={0}
				Position={UDim2.fromOffset(0, 20)}
				Size={new UDim2(1, 0, 0, 8)}
			>
				<frame
					BackgroundColor3={COLORS.text}
					BackgroundTransparency={0.4}
					BorderSizePixel={0}
					Size={() => UDim2.fromScale(clamp01(trail()), 1)}
				/>
				<frame
					BackgroundColor3={() => COLORS.danger.Lerp(COLORS.confirm, clamp01(fill()))}
					BorderSizePixel={0}
					Size={() => UDim2.fromScale(clamp01(fill()), 1)}
				/>
			</frame>
			<frame BackgroundTransparency={1} Position={UDim2.fromOffset(0, 36)} Size={new UDim2(1, 0, 0, 20)}>
				<uilistlayout
					FillDirection={Enum.FillDirection.Horizontal}
					HorizontalAlignment={Enum.HorizontalAlignment.Center}
					Padding={new UDim(0, 16)}
					SortOrder={Enum.SortOrder.LayoutOrder}
				/>
				<Index each={() => state().pool}>
					{(stack, index) => (
						<frame
							AutomaticSize={Enum.AutomaticSize.X}
							BackgroundTransparency={1}
							LayoutOrder={index}
							Size={UDim2.fromOffset(0, 20)}
						>
							<uilistlayout
								FillDirection={Enum.FillDirection.Horizontal}
								Padding={new UDim(0, 6)}
								SortOrder={Enum.SortOrder.LayoutOrder}
								VerticalAlignment={Enum.VerticalAlignment.Center}
							/>
							<Swatch resource={() => stack().resource} />
							<textlabel
								AutomaticSize={Enum.AutomaticSize.X}
								BackgroundTransparency={1}
								FontFace={FONT_DISPLAY}
								LayoutOrder={1}
								Size={UDim2.fromOffset(0, 20)}
								Text={() => tostring(stack().amount)}
								// Red once full: deposits stop there.
								TextColor3={() => (stack().amount >= state().capacity ? COLORS.danger : COLORS.text)}
								TextSize={15}
							/>
						</frame>
					)}
				</Index>
			</frame>
		</HudBox>
	);
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

interface CargoPanelProps {
	readonly inventory: () => Inventory;
	readonly show: () => boolean;
}

/**
 * What the local player carries, bottom left: the total against the capacity
 * with a bar that turns accent when full, and a row for each resource carried.
 * Slides in from the left.
 */
export function CargoPanel({ inventory, show }: CargoPanelProps) {
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
								position={UDim2.fromScale(1, 0)}
								size={UDim2.fromScale(0.3, 1)}
								text={() => tostring(stack().amount)}
								textSize={14}
							/>
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

/** The server's toasts, stacked under the core status, newest at the bottom. */
export function Notices({ notices }: { readonly notices: () => ReadonlyArray<Notice> }) {
	return (
		<frame
			Name="Notices"
			AnchorPoint={new Vector2(0.5, 0)}
			BackgroundTransparency={1}
			Position={new UDim2(0.5, 0, 0, TOP + 88)}
			Size={UDim2.fromOffset(420, 200)}
		>
			<uilistlayout
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				Padding={new UDim(0, 6)}
				SortOrder={Enum.SortOrder.LayoutOrder}
			/>
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
