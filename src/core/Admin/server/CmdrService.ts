import { OnStart, Service } from "@flamework/core";
import { Cmdr } from "@rbxts/cmdr";
import type { Logger } from "@rbxts/log";

import { IS_STUDIO } from "core/shared/constants";

/** User ids allowed to run console commands in live servers. Everyone is allowed in Studio. */
const ADMIN_USER_IDS = new Set<number>([]);

function isAdmin(player: Player): boolean {
	return IS_STUDIO || player.UserId === game.CreatorId || ADMIN_USER_IDS.has(player.UserId);
}

/**
 * Registers the Cmdr console (F2 in game).
 *
 * Commands live in `commands/` as pairs: `foo.ts` is the definition, which
 * Cmdr moves to ReplicatedStorage, so it may only use type imports.
 * `fooServer.ts` is the implementation and may import anything. The
 * `.verbatim` marker in that folder stops Rogen from stripping the `Server`
 * suffix Cmdr relies on.
 */
@Service()
export class CmdrService implements OnStart {
	constructor(private readonly logger: Logger) {}

	onStart() {
		Cmdr.Registry.RegisterHook("BeforeRun", (context) => {
			if (!isAdmin(context.Executor)) return "You do not have permission to run this command.";
			this.logger.Info("{Player} ran: {Command}", context.Executor.Name, context.RawText);
		});

		Cmdr.Registry.RegisterDefaultCommands();
		Cmdr.Registry.RegisterCommandsIn(script.Parent!.WaitForChild("commands"));
	}
}
