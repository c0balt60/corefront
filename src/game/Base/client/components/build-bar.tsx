import { GuiService, Workspace } from "@rbxts/services";
import Vide, { cleanup, derive, effect, For, Index, source } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Brackets } from "core/Interface/client/components/hud";
import { Shadow } from "core/Interface/client/components/shadow";
import { useAppear, useScramble } from "core/Interface/client/motion";
import { COLORS, FONT, FONT_DISPLAY, SPRINGS } from "core/Interface/client/theme";
import { amountOf, type BuildMode, canAfford } from "game/Base/client/base-state";
import { HudBox, Label, Swatch } from "game/Base/client/components/base-hud";
import { InfoButton } from "game/Base/client/components/turret-info";
import {
	BUILD_CATEGORIES,
	type BuildableKind,
	type BuildCategory,
	BUILDABLE,
	BUILDINGS,
	REFUND,
} from "game/Base/shared/buildings";
import { RESOURCES, type ResourceStack } from "game/Base/shared/resources";
import { Glyph } from "game/Research/client/components/glyphs";
import type { GlyphId } from "game/Research/shared/research";

/** Pixels between the HUD and the screen's edges. */
const EDGE = 16;
/** Clear of the hotbar, which takes the bottom 80 pixels of the middle. */
const HINT_BOTTOM = 92;
const TILE = 48;
const RAIL_TILE = 40;
const GAP = 4;
const COLUMNS = 4;
const GRID_WIDTH = COLUMNS * (TILE + GAP) - GAP;
/** Between the grid and the rail, with a divider down its middle. */
const SPLIT = 13;
/** `HudBox`'s padding, across and down. */
const PAD = new Vector2(24, 18);
const WIDTH = GRID_WIDTH + SPLIT + RAIL_TILE + PAD.X;
/** Between the info header and the panel under it. */
const HEADER_GAP = 6;
/** About the tallest the header gets: a name, three costs and three lines of description. */
const HEADER_ROOM = 136;
/** The wave or sandbox panel hangs from this far down the right edge, at most `WAVE_HEIGHT` tall. */
const WAVE_TOP = 0.3;
const WAVE_HEIGHT = 168;

const clamp01 = (value: number) => math.clamp(value, 0, 1);

/** The category last opened, kept while the Build tool is away. */
const picked = source(BUILD_CATEGORIES[0]);

interface TileProps {
	readonly glyph: GlyphId;
	/** Width and height, in pixels. */
	readonly size: number;
	readonly color: Color3;
	readonly selected: () => boolean;
	/** Greys the glyph, while the Core can't pay for it. */
	readonly dim?: () => boolean;
	/** The key that picks it, if any. */
	readonly hotkey?: string;
	readonly layoutOrder: number;
	/** Hidden, and skipped by its layout, while false. */
	readonly visible?: () => boolean;
	readonly onClick: () => void;
	readonly onHover: (entered: boolean) => void;
}

/**
 * One square tile: a glyph, and its hotkey (if it has one) in the corner. Hovering lifts it; picking
 * it grows it, lights its outline and locks brackets onto its corners.
 */
function Tile({ glyph, size, color, selected, dim, hotkey, layoutOrder, visible, onClick, onHover }: TileProps) {
	const hovered = source(false);
	const [lift, liftSpring] = useSpring(0, SPRINGS.responsive);
	const [scale, scaleSpring] = useSpring(1, SPRINGS.bouncy);
	effect(() => {
		liftSpring.setGoal(selected() ? 1 : hovered() ? 0.5 : 0);
		scaleSpring.setGoal(selected() ? 1.06 : hovered() ? 1.03 : 1);
	});
	const glow = () => clamp01(lift());
	// Opaque, so the glyph's cut-outs match it.
	const background = () => COLORS.card.Lerp(COLORS.cardHover, glow());
	// A whole number of pixels per glyph cell keeps it crisp.
	const icon = math.floor((size - 12) / 12) * 12;

	return (
		<frame
			BackgroundTransparency={1}
			LayoutOrder={layoutOrder}
			Size={UDim2.fromOffset(size, size)}
			Visible={visible}
		>
			<frame
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(0.5, 0.5)}
				Size={UDim2.fromScale(1, 1)}
			>
				<uiscale Scale={scale} />
				<Shadow lift={lift} glow={color} scale={0.4} />
				<textbutton
					AutoButtonColor={false}
					BackgroundColor3={background}
					BorderSizePixel={0}
					Size={UDim2.fromScale(1, 1)}
					Text=""
					ZIndex={1}
					MouseEnter={() => {
						hovered(true);
						onHover(true);
					}}
					MouseLeave={() => {
						hovered(false);
						onHover(false);
					}}
					Activated={onClick}
				>
					<uistroke
						ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
						Color={() => COLORS.stroke.Lerp(color, glow())}
						LineJoinMode={Enum.LineJoinMode.Miter}
						Thickness={1.5}
					/>
					<frame
						AnchorPoint={new Vector2(0.5, 0.5)}
						BackgroundTransparency={1}
						Position={UDim2.fromScale(0.5, 0.5)}
						Size={UDim2.fromOffset(icon, icon)}
						ZIndex={1}
					>
						<Glyph
							glyph={glyph}
							color={() => (dim?.() ? COLORS.subtext : COLORS.text)}
							background={background}
						/>
					</frame>
					{hotkey !== undefined ? (
						<textlabel
							AnchorPoint={new Vector2(1, 1)}
							BackgroundColor3={() => COLORS.stroke.Lerp(color, glow())}
							BorderSizePixel={0}
							FontFace={FONT_DISPLAY}
							Position={UDim2.fromScale(1, 1)}
							Size={UDim2.fromOffset(12, 12)}
							Text={hotkey}
							TextColor3={COLORS.text}
							TextSize={10}
							ZIndex={2}
						/>
					) : undefined}
				</textbutton>
				<Brackets kind="hud" color={color} open={lift} visibility={lift} length={6} thickness={1.5} />
			</frame>
		</frame>
	);
}

/** What the header describes: a building, the remove tool, or a category. */
type Subject = BuildMode | BuildCategory;

interface Info {
	readonly name: string;
	readonly tag?: string;
	readonly cost: ReadonlyArray<ResourceStack>;
	readonly description?: string;
}

function infoOf(subject: Subject): Info {
	if (!typeIs(subject, "string")) return { name: subject.name, cost: [] };
	if (subject === "remove") {
		return {
			name: "Remove",
			cost: [],
			description: `Takes down buildings, trees and rocks. Buildings refund ${REFUND * 100}% of their cost.`,
		};
	}
	const def = BUILDINGS[subject];
	return { name: def.name, tag: `${def.size}×${def.size}`, cost: def.cost, description: def.description };
}

interface BuildBarProps {
	/** The buildings the local player can place, in `BUILDABLE` order. Derive it: everything here reads it often. */
	readonly kinds: () => ReadonlyArray<BuildableKind>;
	readonly pool: () => ReadonlyArray<ResourceStack>;
	/** The local player's backpack, counted with the pool in each cost's total. */
	readonly held: () => ReadonlyArray<ResourceStack>;
	readonly mode: () => BuildMode | undefined;
	readonly onSelect: (mode: BuildMode) => void;
	/** Opens a turret's info page (see `TurretInfo`). */
	readonly onInfo: (kind: BuildableKind) => void;
	/** Turns false to put it away. Mount it once: it hides rather than unmounts, so drawing the Build tool makes nothing. */
	readonly show: () => boolean;
}

/**
 * The build menu, bottom right: a rail of categories with the remove tool under them, the open
 * category's buildings as a grid of glyphs beside it, and over both a header naming whatever is
 * hovered (or else picked), with its cost, red where the Core can't pay, how much of each the Core
 * and backpack hold together, and description, with a ? that opens a turret's info page. Picking a building any other way, like copying one
 * with Q, opens its category. The controls for the current mode sit above the hotbar. Shown while
 * the Build tool is out, shrunk to stay under the wave panel. Slides in from the right.
 */
export function BuildBar({ kinds, pool, held, mode, onSelect, onInfo, show }: BuildBarProps) {
	const appear = useAppear(show, 0.1);
	const hint = useScramble(
		"hud",
		() => {
			const current = mode();
			if (current === undefined) return "PICK A BUILDING   ·   F  REMOVE   ·   R  TURN   ·   Q  COPY";
			if (current === "remove") return "CLICK  REMOVE BUILDINGS, TREES, ROCKS   ·   F  CANCEL";
			return "CLICK  PLACE   ·   DRAG  LINE   ·   R  ROTATE   ·   CLICK TILE  CANCEL";
		},
		0.2,
		0.3,
	);

	// Derived: hovering and picking read these through every tile, and working them out each time stalled for frames.
	const categories = derive(() => {
		const available = kinds();
		return BUILD_CATEGORIES.filter((category) => category.kinds.some((kind) => available.includes(kind)));
	});
	const open = derive(() => (categories().includes(picked()) ? picked() : categories()[0]));
	const tiles = derive(() => {
		const available = kinds();
		return open().kinds.filter((kind) => available.includes(kind));
	});
	effect(() => {
		const current = mode();
		if (current === undefined || current === "remove") return;
		const owner = BUILD_CATEGORIES.find((category) => category.kinds.includes(current));
		if (owner) picked(owner);
	});

	const hovered = source<Subject>();
	const hover = (subject: Subject) => (entered: boolean) => {
		if (entered) hovered(subject);
		else if (hovered() === subject) hovered(undefined);
	};
	// Hiding a tile under the mouse doesn't fire its MouseLeave, so the header would open on it next time.
	effect(() => {
		if (!show()) hovered(undefined);
	});
	const info = () => {
		const subject = hovered() ?? mode();
		return subject !== undefined ? infoOf(subject) : undefined;
	};
	// The turret the header is about, for its ?. Reaching for it leaves the tile, so it's the picked one's.
	const turret = () => {
		const subject = hovered() ?? mode();
		return typeIs(subject, "string") && subject !== "remove" && BUILDINGS[subject].turret ? subject : undefined;
	};

	// The rail, the remove tool's tile included, is nearly always the tallest.
	const rail = () => (categories().size() + 1) * (RAIL_TILE + GAP) - GAP;
	const grid = () => math.ceil(tiles().size() / COLUMNS) * (TILE + GAP) - GAP;
	const height = () => math.max(rail(), grid()) + PAD.Y;

	const camera = Workspace.CurrentCamera!;
	const screen = source(camera.ViewportSize.Y);
	cleanup(camera.GetPropertyChangedSignal("ViewportSize").Connect(() => screen(camera.ViewportSize.Y)));
	const scale = () => {
		const [inset] = GuiService.GetGuiInset();
		// ponytail: assumes the wave panel's spot and tallest size; read its frame if it ever moves.
		const room = (screen() - inset.Y) * (1 - WAVE_TOP) - WAVE_HEIGHT - 2 * EDGE;
		// Past half size it would be too small to use: overlapping is better.
		return math.clamp(room / (height() + HEADER_GAP + HEADER_ROOM), 0.5, 1);
	};

	// The header's content grows to fit its text, and the box round it follows.
	const content = source(0);
	const measure = (frame: Frame) => {
		const update = () => content(frame.AbsoluteSize.Y / scale());
		update();
		cleanup(frame.GetPropertyChangedSignal("AbsoluteSize").Connect(update));
	};

	return (
		<>
			<frame
				Name="BuildHint"
				AnchorPoint={new Vector2(0.5, 1)}
				BackgroundTransparency={1}
				Position={() => new UDim2(0.5, 0, 1, -HINT_BOTTOM + 240 * (1 - appear()))}
				Size={UDim2.fromOffset(640, 16)}
				Visible={() => appear() > 0.01}
			>
				<Label alignX={Enum.TextXAlignment.Center} size={UDim2.fromScale(1, 1)} text={hint} />
			</frame>
			<frame
				Name="BuildMenu"
				AnchorPoint={new Vector2(1, 1)}
				BackgroundTransparency={1}
				Position={() => new UDim2(1, -EDGE + (WIDTH + 2 * EDGE) * (1 - appear()), 1, -EDGE)}
				Size={() => UDim2.fromOffset(WIDTH, height())}
				Visible={() => appear() > 0.01}
			>
				<uiscale Scale={scale} />
				<frame
					AnchorPoint={new Vector2(0, 1)}
					BackgroundTransparency={1}
					Position={UDim2.fromOffset(0, -HEADER_GAP)}
					Size={() => UDim2.fromOffset(WIDTH, content() + PAD.Y)}
					Visible={() => info() !== undefined}
				>
					<HudBox
						name="Info"
						anchorPoint={Vector2.zero}
						position={() => UDim2.fromScale(0, 0)}
						size={UDim2.fromScale(1, 1)}
					>
						<frame
							action={measure}
							AutomaticSize={Enum.AutomaticSize.Y}
							BackgroundTransparency={1}
							Size={new UDim2(1, 0, 0, 0)}
						>
							<uilistlayout Padding={new UDim(0, 2)} SortOrder={Enum.SortOrder.LayoutOrder} />
							<frame BackgroundTransparency={1} LayoutOrder={0} Size={new UDim2(1, 0, 0, 18)}>
								<Label
									color={COLORS.text}
									font={FONT_DISPLAY}
									size={new UDim2(1, -64, 1, 0)}
									text={() => info()?.name.upper() ?? ""}
									textSize={14}
								/>
								<InfoButton
									position={new UDim2(1, -44, 0, 0)}
									visible={() => turret() !== undefined}
									onClick={() => {
										const kind = turret();
										if (kind) onInfo(kind);
									}}
								/>
								<Label
									alignX={Enum.TextXAlignment.Right}
									anchorPoint={new Vector2(1, 0)}
									position={UDim2.fromScale(1, 0)}
									size={new UDim2(0, 40, 1, 0)}
									text={() => info()?.tag ?? ""}
								/>
							</frame>
							<Index each={() => info()?.cost ?? []}>
								{(stack, index) => (
									<frame BackgroundTransparency={1} LayoutOrder={index} Size={new UDim2(1, 0, 0, 14)}>
										<Swatch resource={() => stack().resource} />
										<Label
											color={() =>
												amountOf(pool(), stack().resource) >= stack().amount
													? COLORS.text
													: COLORS.danger
											}
											font={FONT_DISPLAY}
											position={UDim2.fromOffset(16, 0)}
											size={new UDim2(0.6, -16, 1, 0)}
											text={() => `${stack().amount} ${RESOURCES[stack().resource].name.upper()}`}
											textSize={12}
										/>
										<Label
											alignX={Enum.TextXAlignment.Right}
											anchorPoint={new Vector2(1, 0)}
											position={UDim2.fromScale(1, 0)}
											size={UDim2.fromScale(0.4, 1)}
											text={() =>
												`HAVE ${amountOf(pool(), stack().resource) + amountOf(held(), stack().resource)}`
											}
										/>
									</frame>
								)}
							</Index>
							<textlabel
								AutomaticSize={Enum.AutomaticSize.Y}
								BackgroundTransparency={1}
								FontFace={FONT}
								LayoutOrder={100}
								Size={new UDim2(1, 0, 0, 0)}
								Text={() => info()?.description ?? ""}
								TextColor3={COLORS.muted}
								TextSize={14}
								TextWrapped={true}
								TextXAlignment={Enum.TextXAlignment.Left}
								Visible={() => info()?.description !== undefined}
							>
								<uipadding PaddingTop={new UDim(0, 4)} />
							</textlabel>
						</frame>
					</HudBox>
				</frame>
				<HudBox
					name="Panel"
					anchorPoint={Vector2.zero}
					position={() => UDim2.fromScale(0, 0)}
					size={UDim2.fromScale(1, 1)}
				>
					<frame BackgroundTransparency={1} Size={new UDim2(0, GRID_WIDTH, 1, 0)}>
						<uigridlayout
							CellPadding={UDim2.fromOffset(GAP, GAP)}
							CellSize={UDim2.fromOffset(TILE, TILE)}
							FillDirectionMaxCells={COLUMNS}
							SortOrder={Enum.SortOrder.LayoutOrder}
						/>
						{/* Every category's tiles, only the open one's shown, so switching categories makes none. */}
						<For each={kinds}>
							{(kind) => (
								<Tile
									color={COLORS.accent}
									dim={() => !canAfford(pool(), BUILDINGS[kind].cost)}
									glyph={kind}
									layoutOrder={BUILDABLE.indexOf(kind)}
									onClick={() => onSelect(kind)}
									onHover={hover(kind)}
									selected={() => mode() === kind}
									size={TILE}
									visible={() => open().kinds.includes(kind)}
								/>
							)}
						</For>
					</frame>
					<frame
						BackgroundColor3={COLORS.stroke}
						BorderSizePixel={0}
						Position={UDim2.fromOffset(GRID_WIDTH + math.floor(SPLIT / 2), 0)}
						Size={new UDim2(0, 1, 1, 0)}
					/>
					<frame
						AnchorPoint={new Vector2(1, 0)}
						BackgroundTransparency={1}
						Position={UDim2.fromScale(1, 0)}
						Size={new UDim2(0, RAIL_TILE, 1, 0)}
					>
						<uilistlayout Padding={new UDim(0, GAP)} SortOrder={Enum.SortOrder.LayoutOrder} />
						<For each={categories}>
							{(category) => (
								<Tile
									color={COLORS.accent}
									glyph={category.glyph}
									layoutOrder={BUILD_CATEGORIES.indexOf(category)}
									onClick={() => picked(category)}
									onHover={hover(category)}
									selected={() => open() === category}
									size={RAIL_TILE}
								/>
							)}
						</For>
						<Tile
							color={COLORS.danger}
							glyph="remove"
							hotkey="F"
							layoutOrder={BUILD_CATEGORIES.size()}
							onClick={() => onSelect("remove")}
							onHover={hover("remove")}
							selected={() => mode() === "remove"}
							size={RAIL_TILE}
						/>
					</frame>
				</HudBox>
			</frame>
		</>
	);
}
