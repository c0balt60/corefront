import { Controller, OnStart } from "@flamework/core";
import { computed, effect } from "@rbxts/charm";
import { UserInputService } from "@rbxts/services";
import { Icon } from "@rbxts/topbar-plus";

import { baseStateAtom } from "game/Base/client/base-state";
import { deployedAtom, starMapOpenAtom } from "game/Planets/client/planets-state";
import { discoveredAtom, levelsAtom, researchOpenAtom } from "game/Research/client/research-state";
import type { Levels } from "game/Research/shared/research";
import { ResearchMessage, researchMessaging } from "game/Research/shared/research-network";

/**
 * Keeps the research atoms in sync with the server, and opens the tree with T
 * or the topbar button whenever the local player is down on a running base
 * with the star map closed. `GameApp` draws it.
 */
@Controller()
export class ResearchController implements OnStart {
	onStart() {
		researchMessaging.client.on(ResearchMessage.State, (state) => {
			const levels: Levels = {};
			for (const { id, level } of state.levels) levels[id] = level;
			levelsAtom(levels);
			discoveredAtom(state.discovered);
		});
		researchMessaging.server.emit(ResearchMessage.Request);

		const canOpen = computed(() => deployedAtom() && !starMapOpenAtom() && baseStateAtom()?.phase === "active");
		const toggle = () => {
			if (canOpen()) researchOpenAtom(!researchOpenAtom());
		};
		effect(() => {
			if (!canOpen()) researchOpenAtom(false);
		});

		const icon = new Icon().setLabel("Research").autoDeselect(false).setEnabled(false);
		icon.toggled.Connect((selected) => {
			if (selected !== researchOpenAtom()) toggle();
		});
		effect(() => {
			icon.setEnabled(canOpen());
			if (researchOpenAtom()) icon.select();
			else icon.deselect();
		});

		UserInputService.InputBegan.Connect((input, processed) => {
			if (!processed && input.KeyCode === Enum.KeyCode.T) toggle();
		});
	}
}
