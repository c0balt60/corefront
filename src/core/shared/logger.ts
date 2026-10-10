import Log, { Logger, LogLevel } from "@rbxts/log";
import { $package } from "rbxts-transform-debug";
import { $NODE_ENV } from "rbxts-transform-env";

/** Debug logs in development builds only. Build with `NODE_ENV=production` to silence them. */
const LOG_LEVEL = $NODE_ENV === "development" ? LogLevel.Debugging : LogLevel.Information;

export function setupLogger(): void {
	Log.SetLogger(
		Logger.configure()
			.SetMinLogLevel(LOG_LEVEL)
			.EnrichWithProperty("Version", $package.version)
			.WriteTo(Log.RobloxOutput())
			.Create(),
	);
}
