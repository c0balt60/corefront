import { Dependency } from "@flamework/core";
import type { CommandContext } from "@rbxts/cmdr";

import { isAlienKind, WaveService } from "game/Base/server/WaveService";

export = function (_context: CommandContext, kind: string, count: number) {
	if (!isAlienKind(kind)) return `Unknown alien "${kind}". Try crawler, brute or spitter.`;

	return Dependency<WaveService>().queue(kind, count) ? `Spawning ${count} ${kind}.` : "No mission is running.";
};
