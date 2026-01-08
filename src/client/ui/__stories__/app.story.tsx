import React, { StrictMode } from "@rbxts/react";
import { ReflexProvider } from "@rbxts/react-reflex";
import ReactRoblox from "@rbxts/react-roblox";
import { CreateReactStory } from "@rbxts/ui-labs";

import { store } from "client/store";

import { App } from "../app/app";
import { ScaleProvider } from "../providers/scale-provider";

export = CreateReactStory({ react: React, reactRoblox: ReactRoblox }, () => {
	return (
		<StrictMode>
			<ScaleProvider>
				<ReflexProvider producer={store}>
					<App />
				</ReflexProvider>
			</ScaleProvider>
		</StrictMode>
	);
});
