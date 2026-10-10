import Log from "@rbxts/log";
import { TeleportService } from "@rbxts/services";

import { IS_STUDIO } from "core/shared/constants";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY = 2;

/**
 * Teleports players to another place in this experience, retrying if Roblox
 * rejects the request. Yields, and returns whether the teleport was accepted.
 *
 * Studio cannot teleport, and neither can a place whose id is still 0, so
 * those only log and return false.
 */
// ponytail: TeleportInitFailed is not handled, so a player whose accepted teleport fails later stays where they are.
export function teleport(placeId: number, players: Array<Player>, options?: TeleportOptions): boolean {
	const names = players.map((player) => player.Name);
	if (IS_STUDIO || placeId === 0) {
		Log.Warn(
			"Skipped teleport of {Players} to place {PlaceId} (Studio, or the place id is not set)",
			names,
			placeId,
		);
		return false;
	}

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const [ok, err] = pcall(() => TeleportService.TeleportAsync(placeId, players, options));
		if (ok) return true;
		Log.Warn("Teleport of {Players} failed (attempt {Attempt}): {Error}", names, attempt, err);
		task.wait(RETRY_DELAY);
	}
	return false;
}
