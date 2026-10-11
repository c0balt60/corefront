import { Dependency } from "@flamework/core";

import { SandboxService } from "game/Base/server/SandboxService";

export = function () {
	Dependency<SandboxService>().start();
	return "Sandbox on. Spawn aliens from the sandbox panel, or with: spawnaliens crawler 10 .";
};
