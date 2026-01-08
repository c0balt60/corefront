import { useMotion } from "@rbxts/pretty-react-hooks";
import type { ReactNode } from "@rbxts/react";
import React, { useEffect, useRef, useState } from "@rbxts/react";

import { DelayRender } from "client/ui/components/delay-render";
import { usePx } from "client/ui/hooks";
import { useDisplay } from "client/ui/hooks/use-display";

import { HomeButton } from "./home-button";
import { NavButton } from "./nav-button";

type MenuScreens = "changelog" | "home" | "settings" | "store";

export default function MainMenu(): ReactNode {
	const display = useDisplay("main-menu");
	const px = usePx();

	const frameRef = useRef<Frame | undefined>(undefined);

	const [menu, setMenu] = useState<MenuScreens>("home");
	const [navHovered, setNavHovered] = useState(false);
	const [navObject, setNavObject] = useState<TextButton | undefined>(undefined);

	const [followNav, setFollowNav] = useMotion<UDim2>(new UDim2());
	const [navTransparency, setNavTransparency] = useMotion(1);
	const [navSize, setNavSize] = useMotion(UDim2.fromOffset(px(100), px(5)));

	useEffect(() => {
		setNavTransparency.spring(navHovered ? 0 : 1);
		setNavSize.spring(
			navHovered && navObject
				? UDim2.fromOffset(navObject.AbsoluteSize.X, px(5))
				: UDim2.fromOffset(0, px(5)),
		);
		if (!navObject || !frameRef.current) {
			return;
		}

		setFollowNav.spring(
			navHovered
				? new UDim2(
						0,
						navObject.AbsolutePosition.X -
							frameRef.current.AbsolutePosition.X +
							navObject.AbsoluteSize.X * 0.5,
						0,
						0,
					)
				: UDim2.fromScale(0.5, 0),
		);
	}, [
		navHovered,
		setNavHovered,
		setFollowNav,
		navObject,
		setNavTransparency,
		setNavSize,
		px,
		frameRef,
	]);

	return (
		<DelayRender ShouldRender={display}>
			<frame
				key="main-menu"
				ref={frameRef}
				BackgroundTransparency={1}
				Size={UDim2.fromScale(1, 1)}
			>
				<frame
					key="nav-bar"
					AnchorPoint={new Vector2(0, 1)}
					BackgroundColor3={new Color3(0, 0, 0)}
					BorderSizePixel={0}
					Position={UDim2.fromScale(0, 1)}
					Size={UDim2.fromScale(1, 0.075)}
				>
					<frame
						key="nav-buttons"
						AnchorPoint={new Vector2(0.5, 0)}
						BackgroundTransparency={1}
						Position={UDim2.fromScale(0.5, 0)}
						Size={UDim2.fromScale(0.5, 1)}
					>
						<uilistlayout
							FillDirection={Enum.FillDirection.Horizontal}
							HorizontalAlignment={Enum.HorizontalAlignment.Center}
							Padding={new UDim(0.01, 0)}
							SortOrder={Enum.SortOrder.LayoutOrder}
							VerticalAlignment={Enum.VerticalAlignment.Center}
							VerticalFlex={Enum.UIFlexAlignment.SpaceAround}
						/>
						<NavButton
							Text="HOME"
							onClick={() => {
								setMenu("home");
							}}
							onMouseEnter={(rbx) => {
								setNavObject(rbx);
								setNavHovered(true);
							}}
							onMouseLeave={() => {
								setNavObject(undefined);
								setNavHovered(false);
							}}
						/>
						<NavButton
							Text="STORE"
							onClick={() => {
								setMenu("store");
							}}
							onMouseEnter={(rbx) => {
								setNavObject(rbx);
								setNavHovered(true);
							}}
							onMouseLeave={() => {
								setNavObject(undefined);
								setNavHovered(false);
							}}
						/>
						<NavButton
							Text="SETTINGS"
							onClick={() => {
								setMenu("settings");
							}}
							onMouseEnter={(rbx) => {
								setNavObject(rbx);
								setNavHovered(true);
							}}
							onMouseLeave={() => {
								setNavObject(undefined);
								setNavHovered(false);
							}}
						/>
						<NavButton
							Text="CHANGELOG"
							onClick={() => {
								setMenu("changelog");
							}}
							onMouseEnter={(rbx) => {
								setNavObject(rbx);
								setNavHovered(true);
							}}
							onMouseLeave={() => {
								setNavObject(undefined);
								setNavHovered(false);
							}}
						/>
					</frame>
					<frame
						key="nav"
						AnchorPoint={new Vector2(0.5, 1)}
						BackgroundColor3={new Color3(1, 1, 1)}
						BackgroundTransparency={navTransparency}
						Position={followNav}
						Size={navSize}
					/>
				</frame>
				<frame
					key="home"
					AnchorPoint={new Vector2(0.5, 0.5)}
					BackgroundTransparency={1}
					Position={UDim2.fromScale(0.5, 0.5)}
					Size={UDim2.fromScale(0.7, 0.65)}
				>
					<HomeButton
						HeaderPosition={UDim2.fromScale(0.05, 0.975)}
						HeaderSize={UDim2.fromScale(0.7, 0.075)}
						Native={{ Size: UDim2.fromScale(0.4, 1) }}
						SubHeaderPosition={UDim2.fromScale(0.05, 0.975)}
						SubHeaderSize={UDim2.fromScale(0.7, 0.05)}
						SubText="Spawn into the game"
						Text="DEPLOY"
						onClick={() => {
							setMenu("home");
						}}
					/>
					<HomeButton
						HeaderPosition={UDim2.fromScale(0.025, 0.95)}
						HeaderSize={UDim2.fromScale(0.7, 0.15)}
						Native={{
							Position: UDim2.fromScale(0.425, 0),
							Size: UDim2.fromScale(0.575, 0.475),
						}}
						SubHeaderPosition={UDim2.fromScale(0.025, 0.95)}
						SubHeaderSize={UDim2.fromScale(0.7, 0.1)}
						SubText="Waste your money on in-game items"
						Text="STORE"
						onClick={() => {
							setMenu("store");
						}}
					/>
					<HomeButton
						HeaderPosition={UDim2.fromScale(0.05, 0.95)}
						HeaderSize={UDim2.fromScale(0.7, 0.135)}
						Native={{
							AnchorPoint: new Vector2(0, 1),
							Position: UDim2.fromScale(0.425, 1),
							Size: UDim2.fromScale(0.275, 0.475),
						}}
						SubHeaderPosition={UDim2.fromScale(0.05, 0.95)}
						SubHeaderSize={UDim2.fromScale(0.85, 0.1)}
						SubText="Click buttons to make game better for ya"
						Text="SETTINGS"
						onClick={() => {
							setMenu("settings");
						}}
					/>
					<HomeButton
						HeaderPosition={UDim2.fromScale(0.05, 0.95)}
						HeaderSize={UDim2.fromScale(0.7, 0.135)}
						Native={{
							AnchorPoint: new Vector2(0, 1),
							Position: UDim2.fromScale(0.725, 1),
							Size: UDim2.fromScale(0.275, 0.475),
						}}
						SubHeaderPosition={UDim2.fromScale(0.05, 0.95)}
						SubHeaderSize={UDim2.fromScale(0.8, 0.1)}
						SubText="View game progress or smth"
						Text="CHANGELOG"
						onClick={() => {
							setMenu("changelog");
						}}
					/>
				</frame>
			</frame>
		</DelayRender>
	);
}
