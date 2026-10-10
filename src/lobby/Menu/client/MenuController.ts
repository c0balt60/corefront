import { Controller, OnStart } from "@flamework/core";
import { subscribe } from "@rbxts/charm";
import { Icon } from "@rbxts/topbar-plus";

import { menuOpenAtom, menuPageAtom } from "lobby/Menu/client/menu-state";

/** Binds a "Menu" topbar button to `menuOpenAtom`, both ways. The menu itself is mounted by `LobbyUiController`. */
@Controller()
export class MenuController implements OnStart {
	onStart() {
		// Not auto-deselecting, so it stays independent of the HUD button.
		const icon = new Icon().setLabel("Menu").autoDeselect(false);
		if (menuOpenAtom()) icon.select();

		icon.toggled.Connect((selected) => menuOpenAtom(selected));
		subscribe(menuOpenAtom, (open) => {
			if (open) menuPageAtom("home");
			if (open === icon.isSelected) return;
			if (open) icon.select();
			else icon.deselect();
		});
	}
}
