import { RunService, Workspace } from "@rbxts/services";
import { cleanup, source } from "@rbxts/vide";

/** The server's clock as a source, updated every frame. Use it to count down to times the server sends. */
export function useServerTime(): () => number {
	const now = source(Workspace.GetServerTimeNow());
	cleanup(RunService.Heartbeat.Connect(() => now(Workspace.GetServerTimeNow())));
	return now;
}
