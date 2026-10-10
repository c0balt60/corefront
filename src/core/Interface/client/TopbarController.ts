import { Controller, OnStart } from "@flamework/core";
import { Icon } from "@rbxts/topbar-plus";

import { hudVisibleAtom } from "core/Interface/client/ui-state";

@Controller()
export class TopbarController implements OnStart {
	onStart() {
		const icon = new Icon().setLabel("HUD");
		if (hudVisibleAtom()) icon.select();
		icon.toggled.Connect((selected) => hudVisibleAtom(selected));
	}
}
