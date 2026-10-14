import Log, { Logger, LogLevel } from "@rbxts/log";
import { $git, $package } from "rbxts-transform-debug";
import { $NODE_ENV } from "rbxts-transform-env";

/** Debug logs in development builds only. Build with `NODE_ENV=production` to silence them. */
const LOG_LEVEL = $NODE_ENV === "development" ? LogLevel.Debugging : LogLevel.Information;

/** The branch and commit this build was compiled from, so playtesters can tell builds apart. */
const BUILD = $git("Branch", "Commit");

export function setupLogger(): void {
	Log.SetLogger(
		Logger.configure()
			.SetMinLogLevel(LOG_LEVEL)
			.EnrichWithProperty("Version", $package.version)
			.WriteTo(Log.RobloxOutput())
			.Create(),
	);
	Log.Info("Build {Branch} @ {Commit}", BUILD.Branch, BUILD.Commit);
}
