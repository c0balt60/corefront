import { Dependency } from "@flamework/core";
import type { CommandContext } from "@rbxts/cmdr";

import { BaseService } from "game/Base/server/BaseService";
import { RESOURCE_ORDER, type ResourceId } from "game/Base/shared/resources";

export = function (_context: CommandContext, player: Player, resource: string, amount: number) {
	if (!RESOURCE_ORDER.includes(resource as ResourceId)) return `Unknown resource "${resource}".`;

	const given = Dependency<BaseService>().give(player, resource as ResourceId, amount);
	return `Gave ${player.Name} ${given} ${resource}.`;
};
