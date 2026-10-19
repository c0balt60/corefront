import { Dependency } from "@flamework/core";

import { BaseService } from "game/Base/server/BaseService";

export = function () {
	return Dependency<BaseService>().end("won") ? "Planet won." : "No mission is running.";
};
