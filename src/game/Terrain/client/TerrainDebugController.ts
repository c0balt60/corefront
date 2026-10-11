import { Controller, OnStart } from "@flamework/core";
import { UserInputService } from "@rbxts/services";

import { terrainDebugAtom, terrainDebugOpenAtom } from "game/Terrain/client/terrain-debug-state";
import { TerrainMessage, terrainMessaging } from "game/Terrain/shared/terrain-network";

/**
 * F4 toggles the terrain debug panel. Opening it the first time asks the server
 * for the generator's state; the server only answers trusted players, and keeps
 * sending updates after that. `GameApp` draws the panel once a state arrives.
 */
@Controller()
export class TerrainDebugController implements OnStart {
	onStart() {
		terrainMessaging.client.on(TerrainMessage.DebugState, (state) => terrainDebugAtom(state));

		let requested = false;
		UserInputService.InputBegan.Connect((input, processed) => {
			if (processed || input.KeyCode !== Enum.KeyCode.F4) return;
			terrainDebugOpenAtom((open) => !open);
			if (requested) return;
			requested = true;
			terrainMessaging.server.emit(TerrainMessage.DebugRequest);
		});
	}
}
