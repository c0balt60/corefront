import { Controller, OnStart } from "@flamework/core";
import { Players } from "@rbxts/services";
import { mount } from "@rbxts/vide";

import { GameApp } from "game/GameUi/client/game-app";

/** Mounts the world server's own interface, next to core's `App`. The game's only bridge between Flamework and Vide. */
@Controller()
export class GameUiController implements OnStart {
	onStart() {
		mount(GameApp, Players.LocalPlayer.WaitForChild("PlayerGui"));
	}
}
