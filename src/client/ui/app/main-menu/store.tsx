import type { ReactNode } from "@rbxts/react";
import React from "@rbxts/react";

import { useTheme } from "client/ui/hooks";

export function MenuStore(): ReactNode {
	const theme = useTheme();

	return (
		<frame
			key="menu-store"
			AnchorPoint={new Vector2(0.5, 0.5)}
			BackgroundTransparency={1}
			Position={UDim2.fromScale(0.5, 0.5)}
			Size={UDim2.fromScale(0.8, 0.7)}
		>
			<frame
				key="product-display"
				BackgroundTransparency={1}
				Position={UDim2.fromScale(0.55, 0)}
				Size={UDim2.fromScale(0.45, 1)}
			>
				<textlabel
					key="header"
					AnchorPoint={new Vector2(0, 1)}
					BackgroundTransparency={1}
					FontFace={Font.fromName(
						theme.fonts.primary.regular.Name,
						Enum.FontWeight.SemiBold,
					)}
					Position={UDim2.fromScale(0, 0.05)}
					Size={UDim2.fromScale(0.6, 0.05)}
					Text="ProductName"
					TextColor3={new Color3(1, 1, 1)}
					TextScaled={true}
					TextXAlignment={Enum.TextXAlignment.Left}
					TextYAlignment={Enum.TextYAlignment.Bottom}
				/>
				<textlabel
					key="description"
					AnchorPoint={new Vector2(0, 1)}
					BackgroundTransparency={1}
					FontFace={Font.fromName(
						theme.fonts.primary.regular.Name,
						Enum.FontWeight.SemiBold,
					)}
					Position={UDim2.fromScale(0, 0.125)}
					Size={UDim2.fromScale(0.6, 0.05)}
					Text="The quick brown fox jumps over the lazy dog"
					TextColor3={Color3.fromRGB(190, 190, 190)}
					TextScaled={true}
					TextXAlignment={Enum.TextXAlignment.Left}
					TextYAlignment={Enum.TextYAlignment.Top}
				>
					<uitextsizeconstraint MaxTextSize={20} />
				</textlabel>
				<imagelabel
					AnchorPoint={new Vector2(0.5, 0)}
					BackgroundTransparency={1}
					Image="rbxassetid://16010744928"
					Position={UDim2.fromScale(0.45, 0.15)}
					ScaleType={Enum.ScaleType.Crop}
					Size={UDim2.fromScale(0.8, 0.25)}
				/>
			</frame>
		</frame>
	);
}
