import React, { StrictMode } from "@rbxts/react";
import { ReflexProvider } from "@rbxts/react-reflex";
import ReactRoblox from "@rbxts/react-roblox";
import { CreateReactStory } from "@rbxts/ui-labs";

import { store } from "client/store";
import { displayAtom } from "client/store/display";

import MainMenu from "../app/main-menu";
import { ScaleProvider } from "../providers/scale-provider";

export = CreateReactStory({ react: React, reactRoblox: ReactRoblox }, () => {
	displayAtom("main-menu");

	return (
		<StrictMode>
			<ScaleProvider>
				<ReflexProvider producer={store}>
					<MainMenu />
				</ReflexProvider>
			</ScaleProvider>
		</StrictMode>
	);
});
