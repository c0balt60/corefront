import { Controller, OnStart } from "@flamework/core";
import { batch, computed, effect } from "@rbxts/charm";
import { UserInputService } from "@rbxts/services";
import { Icon } from "@rbxts/topbar-plus";

import { baseStateAtom, notify } from "game/Base/client/base-state";
import { deployedAtom, starMapOpenAtom, worldStateAtom } from "game/Planets/client/planets-state";
import { discoveredAtom, levelsAtom, researchOpenAtom } from "game/Research/client/research-state";
import { type Levels, lockReason, RESEARCH, RESEARCH_ORDER, type ResearchId } from "game/Research/shared/research";
import { ResearchMessage, researchMessaging } from "game/Research/shared/research-network";

/**
 * Keeps the research atoms in sync with the server, and opens the tree with T
 * or the topbar button whenever the local player is down on a running base
 * with the star map closed, and toasts research as it becomes available. `GameApp` draws it.
 */
@Controller()
export class ResearchController implements OnStart {
	onStart() {
		let received = false;
		researchMessaging.client.on(ResearchMessage.State, (state) => {
			received = true;
			const levels: Levels = {};
			for (const { id, level } of state.levels) levels[id] = level;
			// Together, so the toasts below never see new levels with old discoveries.
			batch(() => {
				levelsAtom(levels);
				discoveredAtom(state.discovered);
			});
		});
		researchMessaging.server.emit(ResearchMessage.Request);

		// Unresearched nodes nothing holds back. The first full set is what the player joined with, so isn't news.
		let available: ReadonlySet<ResearchId> | undefined;
		effect(() => {
			const [levels, discovered, world] = [levelsAtom(), discoveredAtom(), worldStateAtom()];
			if (!received || !world) return;
			const gates = { conquered: world.conquered.size(), discovered };
			const now = new Set(
				RESEARCH_ORDER.filter((id) => (levels[id] ?? 0) === 0 && lockReason(id, levels, gates) === undefined),
			);
			const fresh = available && [...now].filter((id) => !available!.has(id));
			available = now;
			if (fresh && !fresh.isEmpty()) {
				notify(`Research available: ${fresh.map((id) => RESEARCH[id].name).join(", ")}`, "research");
			}
		});

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
