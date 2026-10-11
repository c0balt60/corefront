import { Controller, OnStart } from "@flamework/core";
import { computed, effect } from "@rbxts/charm";
import { Players, Workspace } from "@rbxts/services";

import { enterGalaxy } from "game/Planets/client/galaxy-camera";
import { deployedAtom, worldStateAtom } from "game/Planets/client/planets-state";
import { PlanetsMessage, planetsMessaging } from "game/Planets/shared/planets-network";

/**
 * Keeps the planet atoms in sync with the server and hands the camera to the
 * star map until the local player deploys: it flies up to the map, where the
 * player can orbit, pan and zoom, and flies back down to the character on
 * deploy. A recall hands it back to the map. `GameApp` draws the map and the panel.
 */
@Controller()
export class PlanetsController implements OnStart {
	onStart() {
		const player = Players.LocalPlayer;

		planetsMessaging.client.on(PlanetsMessage.State, (state) => worldStateAtom(state));
		// Recalled: the character is gone, so the effect below flies the camera back up to the map.
		planetsMessaging.client.on(PlanetsMessage.Recall, () => deployedAtom(false));
		player.CharacterAdded.Connect(() => deployedAtom(true));
		if (player.Character) deployedAtom(true);
		planetsMessaging.server.emit(PlanetsMessage.Request);

		const browsing = computed(() => worldStateAtom() !== undefined && !deployedAtom());
		effect(() => {
			const camera = Workspace.CurrentCamera;
			if (!browsing() || !camera) return;
			return enterGalaxy(camera);
		});
	}
}
