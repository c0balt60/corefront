import { useMotion } from "@rbxts/pretty-react-hooks";
import type { ReactNode } from "@rbxts/react";
import React, { useEffect, useState } from "@rbxts/react";

import { useRem, useTheme } from "client/ui/hooks";

interface IHomeButton extends React.PropsWithChildren {
	HeaderPosition: UDim2;
	HeaderSize: UDim2;
	Native?: Partial<React.InstanceProps<Frame>>;
	onClick?: () => void;
	SubHeaderPosition: UDim2;
	SubHeaderSize: UDim2;

	SubText?: string;
	Text?: string;
}

export function HomeButton({
	HeaderPosition,
	HeaderSize,
	Native,
	onClick,
	SubHeaderPosition,
	SubHeaderSize,
	SubText = "filler",
	Text = "Header",
}: Readonly<IHomeButton>): ReactNode {
	const theme = useTheme();
	const rem = useRem();

	const [hovered, setHovered] = useState(false);
	const [pressed, setPressed] = useState(false);

	const [hoveredMotion, setHoveredMotion] = useMotion(0);
	const [pressedMotion, setPressedMotion] = useMotion(new Vector2(0, 0));

	const [headerMotion, setHeaderMotion] = useMotion(UDim2.fromScale());

	useEffect(() => {
		setHoveredMotion.spring(hovered ? 0 : 1);
		setHeaderMotion.spring(
			hovered
				? UDim2.fromScale(
						HeaderPosition.X.Scale,
						HeaderPosition.Y.Scale - SubHeaderSize.Y.Scale + 0.02,
					)
				: UDim2.fromScale(HeaderPosition.X.Scale, HeaderPosition.Y.Scale),
		);
		setPressedMotion.spring(pressed ? new Vector2(0, -2) : new Vector2(0, 0));
	}, [
		hovered,
		setHoveredMotion,
		pressed,
		setPressedMotion,
		setHeaderMotion,
		HeaderPosition,
		SubHeaderSize,
		rem,
	]);

	return (
		<frame BackgroundColor3={new Color3(0, 0, 0)} BackgroundTransparency={0.5} {...Native}>
			<uicorner CornerRadius={new UDim(0.01, 0)} />
			<uistroke
				Color={Color3.fromRGB(62, 62, 62)}
				StrokeSizingMode={Enum.StrokeSizingMode.ScaledSize}
				Thickness={0.005}
			/>
			<textlabel
				key="header"
				AnchorPoint={new Vector2(0, 1)}
				BackgroundTransparency={1}
				FontFace={Font.fromName(theme.fonts.primary.regular.Name, Enum.FontWeight.SemiBold)}
				Position={headerMotion}
				Size={HeaderSize}
				Text={Text}
				TextColor3={new Color3(1, 1, 1)}
				TextScaled={true}
				TextXAlignment={Enum.TextXAlignment.Left}
			/>
			<textlabel
				key="sub-header"
				AnchorPoint={new Vector2(0, 1)}
				BackgroundTransparency={1}
				FontFace={Font.fromName(theme.fonts.primary.regular.Name, Enum.FontWeight.SemiBold)}
				Position={SubHeaderPosition}
				Size={SubHeaderSize}
				Text={SubText}
				TextColor3={new Color3(0.3, 0.3, 0.3)}
				TextScaled={true}
				TextTransparency={hoveredMotion}
				TextXAlignment={Enum.TextXAlignment.Left}
				ZIndex={0}
			/>
			<imagebutton
				key="trigger"
				BackgroundTransparency={1}
				Event={{
					Activated: () => {
						onClick?.();
					},
					MouseButton1Down: () => {
						setPressed(true);
					},
					MouseButton1Up: () => {
						setPressed(false);
						setHovered(false);
					},
					MouseEnter: () => {
						setHovered(true);
					},
					MouseLeave: () => {
						setHovered(false);
						setPressed(false);
					},
				}}
				Image=""
				Size={UDim2.fromScale(1, 1)}
			/>
			<canvasgroup
				key="background"
				BackgroundTransparency={hoveredMotion}
				GroupTransparency={hoveredMotion}
				Size={UDim2.fromScale(1, 1)}
				ZIndex={0}
			>
				<uigradient
					Color={
						new ColorSequence([
							new ColorSequenceKeypoint(0, Color3.fromRGB(63, 48, 48)),
							new ColorSequenceKeypoint(0.5, Color3.fromRGB(63, 48, 48)),
							new ColorSequenceKeypoint(1, new Color3(0, 0, 0)),
						])
					}
					Offset={pressedMotion}
					Rotation={-90}
					Transparency={
						new NumberSequence([
							new NumberSequenceKeypoint(0, 0.5),
							new NumberSequenceKeypoint(1, 1),
						])
					}
				/>
			</canvasgroup>
		</frame>
	);
}

// REVIEW - This interface could use circular hover effect, think of good implementation?
//
// {
// // <canvasgroup key="hover-effect" BackgroundTransparency={1}
// // Size={UDim2.fromScale(1, 1)}> <imagelabel key="hover" AnchorPoint={new
// // Vector2(0.5, 0.5)} BackgroundTransparency={1} Image="rbxassetid://8119252523"
// // 		Position={mouse.map((position) => {
// // 			return UDim2.fromOffset(
// // 				position.X - absolutePosition.getValue().X,
// // 				position.Y - absolutePosition.getValue().Y,
// // 			);
// // 		})}
// // 		ScaleType={Enum.ScaleType.Fit}
// // 		Size={UDim2.fromOffset(px(400), px(400))}
// // />
// // </canvasgroup>
// }
//
