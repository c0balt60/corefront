import { Dependency } from "@flamework/core";
import type { CommandContext } from "@rbxts/cmdr";

import { DataService } from "core/Data/server/DataService";

export = function (_context: CommandContext, player: Player, amount: number) {
	const data = Dependency<DataService>().update(player, (data) => ({ ...data, coins: data.coins + amount }));

	return data ? `${player.Name} now has ${data.coins} coins.` : `${player.Name}'s data has not loaded.`;
};
