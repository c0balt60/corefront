import { Workspace } from "@rbxts/services";
import Vide, { cleanup, effect, For, source } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Brackets } from "core/Interface/client/components/hud";
import { Shadow } from "core/Interface/client/components/shadow";
import { useAppear, useScramble } from "core/Interface/client/motion";
import { COLORS, FONT_DISPLAY, SPRINGS } from "core/Interface/client/theme";
import { amountOf, type BuildMode } from "game/Base/client/base-state";
import { Label, Swatch } from "game/Base/client/components/base-hud";
import { type BuildableKind, BUILDABLE, BUILDINGS, REFUND } from "game/Base/shared/buildings";
import { RESOURCES, type ResourceStack } from "game/Base/shared/resources";

const CARD = new Vector2(112, 84);
const GAP = 8;
/** Clear of the hotbar, which takes the bottom 80 pixels of the middle. */
const BOTTOM = 92;
/** Pixels kept clear either side when the bar has to shrink to fit the screen. */
const MARGIN = 16;

const clamp01 = (value: number) => math.clamp(value, 0, 1);

interface BuildCardProps {
	readonly name: string;
	/** The key that picks it, if any. */
	readonly hotkey?: string;
	readonly cost: ReadonlyArray<ResourceStack>;
	readonly pool: () => ReadonlyArray<ResourceStack>;
	readonly selected: () => boolean;
	readonly color: Color3;
	readonly layoutOrder: number;
	readonly onClick: () => void;
}

/**
 * One square card: its hotkey (if it has one), its name, and its cost, each line red while the
 * core can't pay it. Hovering lifts it; picking it grows it, lights its outline
 * and hotkey and locks brackets onto its corners.
 */
function BuildCard({ name, hotkey, cost, pool, selected, color, layoutOrder, onClick }: BuildCardProps) {
	const hovered = source(false);
	const [lift, liftSpring] = useSpring(0, SPRINGS.responsive);
	const [scale, scaleSpring] = useSpring(1, SPRINGS.bouncy);
	effect(() => {
		liftSpring.setGoal(selected() ? 1 : hovered() ? 0.5 : 0);
		scaleSpring.setGoal(selected() ? 1.06 : hovered() ? 1.03 : 1);
	});
	const glow = () => clamp01(lift());

	return (
		<frame BackgroundTransparency={1} LayoutOrder={layoutOrder} Size={UDim2.fromOffset(CARD.X, CARD.Y)}>
			<frame
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(0.5, 0.5)}
				Size={UDim2.fromScale(1, 1)}
			>
				<uiscale Scale={scale} />
				<Shadow lift={lift} glow={color} scale={0.6} />
				<textbutton
					AutoButtonColor={false}
					BackgroundColor3={() => COLORS.card.Lerp(COLORS.cardHover, glow())}
					BackgroundTransparency={0.35}
					BorderSizePixel={0}
					Size={UDim2.fromScale(1, 1)}
					Text=""
					ZIndex={1}
					MouseEnter={() => hovered(true)}
					MouseLeave={() => hovered(false)}
					Activated={onClick}
				>
					<uistroke
						ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
						Color={() => COLORS.stroke.Lerp(color, glow())}
						LineJoinMode={Enum.LineJoinMode.Miter}
						Thickness={1.5}
					/>
					<uipadding
						PaddingBottom={new UDim(0, 8)}
						PaddingLeft={new UDim(0, 8)}
						PaddingRight={new UDim(0, 8)}
						PaddingTop={new UDim(0, 8)}
					/>
					{hotkey !== undefined ? (
						<textlabel
							BackgroundColor3={() => COLORS.stroke.Lerp(color, glow())}
							BorderSizePixel={0}
							FontFace={FONT_DISPLAY}
							Size={UDim2.fromOffset(18, 18)}
							Text={hotkey}
							TextColor3={COLORS.text}
							TextSize={12}
						/>
					) : undefined}
					<Label
						alignX={Enum.TextXAlignment.Right}
						anchorPoint={new Vector2(1, 0)}
						color={COLORS.text}
						font={FONT_DISPLAY}
						position={UDim2.fromScale(1, 0)}
						size={new UDim2(1, -24, 0, 18)}
						text={name.upper()}
						textSize={14}
					/>
					<frame
						AnchorPoint={new Vector2(0, 1)}
						BackgroundTransparency={1}
						Position={UDim2.fromScale(0, 1)}
						Size={new UDim2(1, 0, 0, 32)}
					>
						<uilistlayout
							Padding={new UDim(0, 2)}
							SortOrder={Enum.SortOrder.LayoutOrder}
							VerticalAlignment={Enum.VerticalAlignment.Bottom}
						/>
						{cost.size() > 0 ? (
							cost.map((stack, index) => (
								<frame BackgroundTransparency={1} LayoutOrder={index} Size={new UDim2(1, 0, 0, 14)}>
									<Swatch resource={() => stack.resource} />
									<Label
										color={() =>
											amountOf(pool(), stack.resource) >= stack.amount
												? COLORS.text
												: COLORS.danger
										}
										font={FONT_DISPLAY}
										position={UDim2.fromOffset(16, 0)}
										size={new UDim2(1, -16, 1, 0)}
										text={`${stack.amount} ${RESOURCES[stack.resource].name.upper()}`}
										textSize={12}
									/>
								</frame>
							))
						) : (
							<Label size={new UDim2(1, 0, 0, 14)} text={`REFUNDS ${REFUND * 100}%`} textSize={11} />
						)}
					</frame>
				</textbutton>
				<Brackets kind="hud" color={color} open={lift} visibility={lift} length={8} thickness={1.5} />
			</frame>
		</frame>
	);
}

interface BuildBarProps {
	/** The buildings the local player can place, in `BUILDABLE` order. */
	readonly kinds: () => ReadonlyArray<BuildableKind>;
	readonly pool: () => ReadonlyArray<ResourceStack>;
	readonly mode: () => BuildMode | undefined;
	readonly onSelect: (mode: BuildMode) => void;
	/** Turns false to drop it away. Return `$tuple(node, EXIT_TIME)` from the Show that renders it. */
	readonly show: () => boolean;
}

/**
 * The buildings and the remove tool as cards, bottom centre above the hotbar,
 * with the controls for the current mode over them, shrunk to fit narrow screens.
 * Shown while the Build tool is out. Rises in from the bottom.
 */
export function BuildBar({ kinds, pool, mode, onSelect, show }: BuildBarProps) {
	const rise = useAppear(show, 0.1);
	const hint = useScramble(
		"hud",
		() => {
			const current = mode();
			if (current === undefined) return "CLICK A CARD  BUILD   ·   F  REMOVE   ·   R  TURN   ·   Q  COPY";
			if (current === "remove") return "CLICK  REMOVE BUILDINGS, TREES, ROCKS   ·   F  CANCEL";
			return "CLICK  PLACE   ·   DRAG  LINE   ·   R  ROTATE   ·   CLICK CARD  CANCEL";
		},
		0.2,
		0.3,
	);
	// The shown cards, the remove tool's included.
	const width = () => (kinds().size() + 1) * (CARD.X + GAP) - GAP;
	const camera = Workspace.CurrentCamera!;
	const screen = source(camera.ViewportSize.X);
	cleanup(camera.GetPropertyChangedSignal("ViewportSize").Connect(() => screen(camera.ViewportSize.X)));

	return (
		<frame
			Name="BuildBar"
			AnchorPoint={new Vector2(0.5, 1)}
			BackgroundTransparency={1}
			Position={() => new UDim2(0.5, 0, 1, -BOTTOM + 240 * (1 - rise()))}
			Size={() => UDim2.fromOffset(width(), CARD.Y + 26)}
		>
			<uiscale Scale={() => math.min(1, (screen() - 2 * MARGIN) / width())} />
			<Label alignX={Enum.TextXAlignment.Center} size={new UDim2(1, 0, 0, 16)} text={hint} />
			<frame
				AnchorPoint={new Vector2(0, 1)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(0, 1)}
				Size={new UDim2(1, 0, 0, CARD.Y)}
			>
				<uilistlayout
					FillDirection={Enum.FillDirection.Horizontal}
					HorizontalAlignment={Enum.HorizontalAlignment.Center}
					Padding={new UDim(0, GAP)}
					SortOrder={Enum.SortOrder.LayoutOrder}
				/>
				<For each={kinds}>
					{(kind) => (
						<BuildCard
							color={COLORS.accent}
							cost={BUILDINGS[kind].cost}
							layoutOrder={BUILDABLE.indexOf(kind)}
							name={BUILDINGS[kind].name}
							onClick={() => onSelect(kind)}
							pool={pool}
							selected={() => mode() === kind}
						/>
					)}
				</For>
				<BuildCard
					color={COLORS.danger}
					cost={[]}
					hotkey="F"
					layoutOrder={BUILDABLE.size()}
					name="Remove"
					onClick={() => onSelect("remove")}
					pool={pool}
					selected={() => mode() === "remove"}
				/>
			</frame>
		</frame>
	);
}
