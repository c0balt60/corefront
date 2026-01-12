import React, { useEffect } from "@rbxts/react";
import { useAtom } from "@rbxts/react-charm";

import { displayAtom } from "client/store/display";

import { Layer } from "../components/primitive";
import LoadingScreen from "./loading-screen";
import MainMenu from "./main-menu";
import { MenuBackground } from "./menu-background";
import { Transition } from "./transition";

export function App(): React.ReactNode {
	const display = useAtom(displayAtom);

	useEffect(() => {
		print("display changed: ", display);
		// transitionAtom({ delay: 5, type: "in" });
	});

	return (
		<>
			<Layer key="Transition" DisplayOrder={1000}>
				<Transition />
			</Layer>

			<Layer key="MainInterface">
				<MenuBackground />
				<LoadingScreen />
				<MainMenu />
			</Layer>

			<Layer key="example-layer" />

			<Layer key="example-layer1" />
		</>
	);
}
