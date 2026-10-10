import { Controller, OnStart } from "@flamework/core";
import { Players } from "@rbxts/services";
import { mount } from "@rbxts/vide";

import { LobbyApp } from "lobby/LobbyUi/client/lobby-app";

/** Mounts the lobby's own interface, next to core's `App`. The lobby's only bridge between Flamework and Vide. */
@Controller()
export class LobbyUiController implements OnStart {
	onStart() {
		mount(LobbyApp, Players.LocalPlayer.WaitForChild("PlayerGui"));
	}
}
