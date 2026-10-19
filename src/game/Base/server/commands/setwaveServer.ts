import { Dependency } from "@flamework/core";
import type { CommandContext } from "@rbxts/cmdr";

import { WaveService } from "game/Base/server/WaveService";

export = function (_context: CommandContext, wave: number) {
	const waves = Dependency<WaveService>();
	if (waves.isAttack()) return "This is an attack mission: it has no waves.";
	return waves.setWave(wave) ? `Next wave is ${wave + 1}.` : "No mission is running.";
};
