import { useMouse, useViewport } from "@rbxts/pretty-react-hooks";
import type { ReactNode } from "@rbxts/react";
import React, { useMemo } from "@rbxts/react";

import { usePx, useTheme } from "../hooks";

export function MenuBackground(): ReactNode {
	const theme = useTheme();
	const mouse = useMouse();
	const viewport = useViewport();
	const px = usePx();

	const mouseFromCenter = useMemo(() => {
		return mouse.map((position) => viewport.getValue().div(2).sub(position));
	}, [viewport, mouse]);

	return (
		<frame
			key="menu-background"
			BackgroundColor3={Color3.fromRGB(31, 31, 31)}
			BackgroundTransparency={0}
			Size={UDim2.fromScale(1, 1)}
			ZIndex={-100}
		>
			<imagelabel
				key="Background"
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Image={theme.images.LoadingScreen.Background}
				ImageTransparency={0.5}
				Position={mouseFromCenter.map((position) => {
					return new UDim2(
						0.5,
						math.clamp(px(position.X) * 0.1, -120, 120),
						0.5,
						math.clamp(px(position.Y) * 0.1, -100, 100),
					);
				})}
				ScaleType={Enum.ScaleType.Crop}
				Size={UDim2.fromScale(1.2, 1.2)}
				ZIndex={-10}
			/>
			<imagelabel
				key="Vingette"
				BackgroundColor3={new Color3(0, 0, 0)}
				BackgroundTransparency={0.4}
				Image={theme.images.Vingette}
				ImageTransparency={0.5}
				Size={UDim2.fromScale(1, 1)}
				ZIndex={-9}
			/>
		</frame>
	);
}
