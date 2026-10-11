import { Dependency } from "@flamework/core";
import type { CommandContext } from "@rbxts/cmdr";

import { BaseService } from "game/Base/server/BaseService";
import { RESOURCE_ORDER, type ResourceId } from "game/Base/shared/resources";

export = function (_context: CommandContext, resource: string, amount: number) {
	if (!RESOURCE_ORDER.includes(resource as ResourceId)) return `Unknown resource "${resource}".`;

	return Dependency<BaseService>().addToPool(resource as ResourceId, amount)
		? `Added ${amount} ${resource} to the Core.`
		: `No mission is running, or this planet has no ${resource}.`;
};
