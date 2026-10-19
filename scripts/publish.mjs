// Publishes every built place to one environment: `node scripts/publish.mjs testing`.
// Run `pnpm build` first, and set RBXCLOUD_API_KEY.
import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

import { ENVIRONMENTS } from "../src/core/Teleport/shared/environments.ts";

const name = process.argv[2];
const environment = ENVIRONMENTS[name];
if (!environment) throw new Error(`Unknown environment "${name}", expected: ${Object.keys(ENVIRONMENTS).join(", ")}`);

for (const [place, placeId] of Object.entries(environment.places)) {
	if (!environment.universeId || !placeId) {
		throw new Error(
			`Fill in the ${name} universe and ${place} place ids in src/core/Teleport/shared/environments.ts`,
		);
	}
	console.log(`Publishing ${place} to ${name} (universe ${environment.universeId}, place ${placeId})`);
	// Roblox answers 409 "Server is busy" while a Team Create session is open on the place,
	// including for a few minutes after the last editor leaves Studio.
	for (let attempt = 1; ; attempt++) {
		const { status, stdout, stderr } = spawnSync(
			"rbxcloud",
			[
				"experience",
				"publish",
				"--filename",
				`places/${place}/${place}.rbxl`,
				"--universe-id",
				String(environment.universeId),
				"--place-id",
				String(placeId),
				"--version-type",
				"published",
			],
			{ encoding: "utf8" },
		);
		process.stdout.write(stdout);
		process.stderr.write(stderr);
		if (status === 0) break;
		if (attempt === 3) {
			if (`${stdout}${stderr}`.includes("409")) {
				console.log(
					`::error::${place} (place ${placeId}) is locked by a Team Create session. Close it in Studio (or disable Collaborative Editing on this place) and re-run the job.`,
				);
			}
			process.exit(status ?? 1);
		}
		console.log(`Publish failed, retrying in 60s (attempt ${attempt + 1}/3)`);
		await setTimeout(60_000);
	}
}
