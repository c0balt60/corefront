import Vide, { source } from "@rbxts/vide";

import { COLORS } from "core/Interface/client/theme";

interface ScrollListProps {
	readonly anchorPoint?: Vector2;
	readonly position?: UDim2;
	readonly size?: UDim2;
	/** Space between items, in pixels. */
	readonly gap?: number;
	/** Space above the first item and below the last, in pixels, so neither sits against the edge. */
	readonly padding?: number;
	readonly children?: Vide.Node;
}

/**
 * A vertical scrolling list whose canvas is sized from its items plus padding,
 * so the last item is never cut off. Give items an offset height or a
 * `SizeConstraint`, never a Y scale: a Y scale is relative to the canvas.
 */
export function ScrollList({ anchorPoint, position, size, gap = 8, padding = 12, children }: ScrollListProps) {
	const contentHeight = source(0);

	return (
		<scrollingframe
			AnchorPoint={anchorPoint}
			BackgroundTransparency={1}
			BorderSizePixel={0}
			CanvasSize={() => UDim2.fromOffset(0, contentHeight() + padding * 2)}
			Position={position}
			ScrollBarImageColor3={COLORS.muted}
			ScrollBarThickness={6}
			ScrollingDirection={Enum.ScrollingDirection.Y}
			Size={size ?? UDim2.fromScale(1, 1)}
			VerticalScrollBarInset={Enum.ScrollBarInset.ScrollBar}
		>
			<uipadding
				PaddingBottom={new UDim(0, padding)}
				PaddingLeft={new UDim(0, padding)}
				PaddingRight={new UDim(0, padding)}
				PaddingTop={new UDim(0, padding)}
			/>
			<uilistlayout
				action={(layout) => {
					const update = () => contentHeight(layout.AbsoluteContentSize.Y);
					update();
					layout.GetPropertyChangedSignal("AbsoluteContentSize").Connect(update);
				}}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				Padding={new UDim(0, gap)}
				SortOrder={Enum.SortOrder.LayoutOrder}
			/>
			{children}
		</scrollingframe>
	);
}
