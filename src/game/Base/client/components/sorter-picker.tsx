import Vide, { cleanup, source } from "@rbxts/vide";

import { COLORS, FONT_DISPLAY } from "core/Interface/client/theme";
import { Label } from "game/Base/client/components/base-hud";
import { RESOURCE_ORDER, RESOURCES, type ResourceId } from "game/Base/shared/resources";

const SWATCH = 24;
const GAP = 4;
const PADDING = 8;

interface SorterPickerProps {
	readonly sorter: Model;
	readonly enabled: () => boolean;
	/** The ore to let through now, or undefined for none. */
	readonly onPick: (resource: ResourceId | undefined) => void;
}

/**
 * Floats over a Sorter: a swatch for every ore, the one it lets through outlined. Clicking one
 * lets that ore through instead; clicking the outlined one lets nothing through. It has to live
 * in PlayerGui, not on the Sorter, to take clicks.
 */
export function SorterPicker({ sorter, enabled, onPick }: SorterPickerProps) {
	const filter = source(sorter.GetAttribute("Filter") as ResourceId | undefined);
	// Turning the sorter remakes its parts, the body among them.
	const body = source(sorter.PrimaryPart);
	cleanup(
		sorter
			.GetAttributeChangedSignal("Filter")
			.Connect(() => filter(sorter.GetAttribute("Filter") as ResourceId | undefined)),
	);
	cleanup(sorter.GetPropertyChangedSignal("PrimaryPart").Connect(() => body(sorter.PrimaryPart)));

	return (
		<billboardgui
			Name="SorterPicker"
			Active={true}
			Adornee={body}
			Enabled={enabled}
			LightInfluence={0}
			MaxDistance={70}
			ResetOnSpawn={false}
			Size={UDim2.fromOffset(
				RESOURCE_ORDER.size() * (SWATCH + GAP) - GAP + 2 * PADDING,
				SWATCH + 20 + 2 * PADDING,
			)}
			StudsOffsetWorldSpace={new Vector3(0, 6, 0)}
		>
			<frame
				BackgroundColor3={COLORS.card}
				BackgroundTransparency={0.25}
				BorderSizePixel={0}
				Size={UDim2.fromScale(1, 1)}
			>
				<uistroke Color={COLORS.stroke} LineJoinMode={Enum.LineJoinMode.Miter} Thickness={1} />
				<uipadding
					PaddingBottom={new UDim(0, PADDING)}
					PaddingLeft={new UDim(0, PADDING)}
					PaddingRight={new UDim(0, PADDING)}
					PaddingTop={new UDim(0, PADDING)}
				/>
				<Label
					color={COLORS.text}
					font={FONT_DISPLAY}
					size={new UDim2(1, 0, 0, 14)}
					text={() => {
						const resource = filter();
						return resource !== undefined
							? `PASSES ${RESOURCES[resource].name.upper()}`
							: "PASSES NOTHING · PICK AN ORE";
					}}
					textSize={12}
				/>
				<frame
					AnchorPoint={new Vector2(0, 1)}
					BackgroundTransparency={1}
					Position={UDim2.fromScale(0, 1)}
					Size={new UDim2(1, 0, 0, SWATCH)}
				>
					<uilistlayout
						FillDirection={Enum.FillDirection.Horizontal}
						Padding={new UDim(0, GAP)}
						SortOrder={Enum.SortOrder.LayoutOrder}
					/>
					{RESOURCE_ORDER.map((resource, index) => (
						<textbutton
							AutoButtonColor={true}
							BackgroundColor3={RESOURCES[resource].color}
							BorderSizePixel={0}
							LayoutOrder={index}
							Size={UDim2.fromOffset(SWATCH, SWATCH)}
							Text=""
							Activated={() => onPick(filter() === resource ? undefined : resource)}
						>
							<uistroke
								ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
								Color={() => (filter() === resource ? COLORS.text : COLORS.stroke)}
								LineJoinMode={Enum.LineJoinMode.Miter}
								Thickness={() => (filter() === resource ? 2.5 : 1)}
							/>
						</textbutton>
					))}
				</frame>
			</frame>
		</billboardgui>
	);
}
