import { useMotion } from "@rbxts/pretty-react-hooks";
import type { ReactNode } from "@rbxts/react";
import React, { useEffect, useState } from "@rbxts/react";

import { useTheme } from "client/ui/hooks";

interface INavButton {
	onClick?: (rbx: TextButton) => void;
	onMouseEnter?: (rbx: TextButton) => void;
	onMouseLeave?: (rbx: TextButton) => void;

	Text?: string;
}

export function NavButton({
	onClick,
	onMouseEnter,
	onMouseLeave,
	Text = "Button",
}: Readonly<INavButton>): ReactNode {
	const theme = useTheme();

	const [pressed, setPressed] = useState(false);

	const [pressedMotion, setPressedMotion] = useMotion(new UDim2());
	const [transparencyMotion, setTransparencyMotion] = useMotion(1);
	const [positionMotion, setPositionMotion] = useMotion(new UDim2());
	const [anchorMotion, setAnchorMotion] = useMotion(new Vector2());

	useEffect(() => {
		// setPositionMotion.spring(UDim2.fromScale(0, pressed ? 1 : 0), { frequency: 1 });
		// setAnchorMotion.spring(new Vector2(0, pressed ? 1 : 0), { frequency: 1 });
		setPositionMotion.set(UDim2.fromScale(0, pressed ? 1 : 0));
		setAnchorMotion.set(new Vector2(0, pressed ? 1 : 0));

		setPressedMotion.spring(UDim2.fromScale(1, pressed ? 1 : 0), { frequency: 0.25 });
		setTransparencyMotion.spring(pressed ? 0 : 1);
	}, [pressed, setPressedMotion, setTransparencyMotion, setPositionMotion, setAnchorMotion]);

	return (
		<textbutton
			BackgroundTransparency={1}
			Event={{
				Activated: (rbx) => {
					onClick?.(rbx);
				},
				MouseButton1Down: () => {
					setPressed(true);
				},
				MouseButton1Up: () => {
					setPressed(false);
				},
				MouseEnter: (rbx) => {
					onMouseEnter?.(rbx);
				},
				MouseLeave: (rbx) => {
					onMouseLeave?.(rbx);
					setPressed(false);
				},
			}}
			Size={UDim2.fromScale(0.175, 1)}
			Text=""
		>
			<textlabel
				BackgroundTransparency={1}
				FontFace={Font.fromName(theme.fonts.primary.regular.Name, Enum.FontWeight.Regular)}
				Size={UDim2.fromScale(1, 1)}
				Text={Text}
				TextColor3={new Color3(1, 1, 1)}
				TextScaled={true}
			>
				<uipadding PaddingBottom={new UDim(0.325, 0)} PaddingTop={new UDim(0.325, 0)} />
			</textlabel>

			<frame
				AnchorPoint={anchorMotion}
				BackgroundColor3={new Color3(1, 1, 1)}
				BackgroundTransparency={transparencyMotion}
				BorderSizePixel={0}
				Position={positionMotion}
				Size={pressedMotion}
			/>
		</textbutton>
	);
}
