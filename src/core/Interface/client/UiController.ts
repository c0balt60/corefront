import { Controller, OnStart } from "@flamework/core";
import { Players } from "@rbxts/services";
import { mount } from "@rbxts/vide";

import { App } from "core/Interface/client/app";

/**
 * Mounts the shared `App`. Each place mounts its own app the same way, from its
 * `<Place>Ui` feature. These are the only bridges between Flamework and Vide.
 * Everything else in the UI is plain modules, so components render in UI Labs
 * without Flamework running.
 */
@Controller()
export class UiController implements OnStart {
	onStart() {
		mount(App, Players.LocalPlayer.WaitForChild("PlayerGui"));
	}
}
