import { Flamework, Modding } from "@flamework/core";
import Log, { Logger } from "@rbxts/log";

import { setupLogger } from "core/shared/logger";

setupLogger();
Modding.registerDependency<Logger>((ctor) => Log.ForContext(ctor));

// Singletons are found by file name, so UI modules and stories are never required by Flamework.
// The globs span every place (`src/<place>/<Feature>/...`). Each place compiles them against its own
// project and Flamework keeps only the files found there, so a place loads core plus its own features.
Flamework.addPathsGlob("src/*/*/client/**/*{Controller,Component}.ts");
Flamework.addPathsGlob("src/*/*/shared/**/*Component.ts");
Flamework.ignite();
