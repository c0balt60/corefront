import { Dependency } from "@flamework/core";

import { WaveService } from "game/Base/server/WaveService";

export = function () {
	const waves = Dependency<WaveService>();
	if (waves.isAttack()) return "This is an attack mission: it has no waves.";
	return waves.launch() ? "Wave launched." : "No mission is running, or every wave is out.";
};
