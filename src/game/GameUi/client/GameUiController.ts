import { Controller, OnStart } from "@flamework/core";
import { Players } from "@rbxts/services";
import { mount } from "@rbxts/vide";

import { MatchApp } from "match/MatchUi/client/match-app";

/** Mounts the match's own interface, next to core's `App`. The match's only bridge between Flamework and Vide. */
@Controller()
export class MatchUiController implements OnStart {
	onStart() {
		mount(MatchApp, Players.LocalPlayer.WaitForChild("PlayerGui"));
	}
}
