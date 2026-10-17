import Vide, { effect, Index, source } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Brackets } from "core/Interface/client/components/hud";
import { useAppear } from "core/Interface/client/motion";
import { CARD_TRANSPARENCY, COLORS, FONT_DISPLAY, SPRINGS } from "core/Interface/client/theme";
import { Label } from "game/Base/client/components/base-hud";

const SLOT = 64;
const GAP = 6;
const BOTTOM = 16;

const clamp01 = (value: number) => math.clamp(value, 0, 1);

interface SlotProps {
	readonly tool: () => Tool;
	/** The slot's number, from 1: also its key. */
	readonly slot: number;
	readonly equipped: () => boolean;
	readonly onClick: () => void;
}

/** One square slot: its number key and its tool's name. Out, it lights up accent and brackets lock onto it. */
function Slot({ tool, slot, equipped, onClick }: SlotProps) {
	const hovered = source(false);
	const [lift, liftSpring] = useSpring(0, SPRINGS.responsive);
	effect(() => liftSpring.setGoal(equipped() ? 1 : hovered() ? 0.4 : 0));
	const glow = () => clamp01(lift());

	return (
		<textbutton
			Name={() => `Slot_${tool().Name}`}
			AutoButtonColor={false}
			BackgroundColor3={() => COLORS.card.Lerp(COLORS.cardHover, glow())}
			BackgroundTransparency={CARD_TRANSPARENCY}
			BorderSizePixel={0}
			LayoutOrder={slot}
			Size={UDim2.fromOffset(SLOT, SLOT)}
			Text=""
			MouseEnter={() => hovered(true)}
			MouseLeave={() => hovered(false)}
			Activated={onClick}
		>
			<uistroke
				ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
				Color={() => COLORS.stroke.Lerp(COLORS.accent, glow())}
				LineJoinMode={Enum.LineJoinMode.Miter}
				Thickness={1.5}
			/>
			<Label
				color={() => COLORS.muted.Lerp(COLORS.accent, glow())}
				font={FONT_DISPLAY}
				position={UDim2.fromOffset(6, 4)}
				size={UDim2.fromOffset(16, 14)}
				text={tostring(slot)}
				textSize={12}
			/>
			<Label
				alignX={Enum.TextXAlignment.Center}
				anchorPoint={new Vector2(0.5, 1)}
				color={COLORS.text}
				font={FONT_DISPLAY}
				position={new UDim2(0.5, 0, 1, -6)}
				size={new UDim2(1, -8, 0, 14)}
				text={() => tool().Name.upper()}
				textSize={12}
			/>
			<Brackets kind="hud" color={COLORS.accent} open={glow} visibility={glow} length={8} thickness={1.5} />
		</textbutton>
	);
}

interface HotbarProps {
	readonly tools: () => ReadonlyArray<Tool>;
	readonly equipped: () => Tool | undefined;
	readonly onSelect: (tool: Tool) => void;
	/** Turns false to drop it away. Return `$tuple(node, EXIT_TIME)` from the Show that renders it. */
	readonly show: () => boolean;
}

/** The character's tools as numbered slots, bottom centre, in place of Roblox's backpack. Rises in from the bottom. */
export function Hotbar({ tools, equipped, onSelect, show }: HotbarProps) {
	const rise = useAppear(show, 0.05);

	return (
		<frame
			Name="Hotbar"
			AnchorPoint={new Vector2(0.5, 1)}
			AutomaticSize={Enum.AutomaticSize.X}
			BackgroundTransparency={1}
			Position={() => new UDim2(0.5, 0, 1, -BOTTOM + 120 * (1 - rise()))}
			Size={UDim2.fromOffset(0, SLOT)}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				Padding={new UDim(0, GAP)}
				SortOrder={Enum.SortOrder.LayoutOrder}
			/>
			{/* Index hands over the Lua key, so it counts from 1 despite its typings. */}
			<Index each={tools}>
				{(tool, slot) => (
					<Slot
						equipped={() => equipped() === tool()}
						slot={slot}
						onClick={() => onSelect(tool())}
						tool={tool}
					/>
				)}
			</Index>
		</frame>
	);
}
