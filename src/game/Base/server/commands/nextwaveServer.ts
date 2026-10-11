import { Dependency } from "@flamework/core";

import { WaveService } from "game/Base/server/WaveService";

export = function () {
	return Dependency<WaveService>().launch() ? "Wave launched." : "No mission is running, or every wave is out.";
};
