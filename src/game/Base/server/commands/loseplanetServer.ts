import { Dependency } from "@flamework/core";

import { BaseService } from "game/Base/server/BaseService";

export = function () {
	return Dependency<BaseService>().end("lost") ? "Planet lost." : "No mission is running.";
};
