import { Dependency } from "@flamework/core";
import type { CommandContext } from "@rbxts/cmdr";

import { WaveService } from "game/Base/server/WaveService";

export = function (_context: CommandContext, wave: number) {
	return Dependency<WaveService>().setWave(wave) ? `Next wave is ${wave + 1}.` : "No mission is running.";
};
