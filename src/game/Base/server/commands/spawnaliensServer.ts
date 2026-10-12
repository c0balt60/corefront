import { Dependency } from "@flamework/core";
import type { CommandContext } from "@rbxts/cmdr";

import { isAlienKind, WaveService } from "game/Base/server/WaveService";
import { ALIEN_KINDS } from "game/Base/shared/base-network";

/** How far in front of `near` the aliens spawn, in studs. */
const NEAR_STUDS = 40;

export = function (_context: CommandContext, kind: string, count: number, near?: Player) {
	if (!isAlienKind(kind)) return `Unknown alien "${kind}". Try one of: ${ALIEN_KINDS.join(", ")}.`;
	const pivot = near?.Character?.GetPivot();
	if (near && !pivot) return `${near.Name} has no character.`;

	const at = pivot?.Position.add(pivot.LookVector.mul(NEAR_STUDS));
	return Dependency<WaveService>().queue(kind, count, at) ? `Spawning ${count} ${kind}.` : "No mission is running.";
};
