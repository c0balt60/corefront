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
	// Roblox intermittently answers 409 "Server is busy, try again in a couple minutes".
	for (let attempt = 1; ; attempt++) {
		const { status } = spawnSync(
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
			{ stdio: "inherit" },
		);
		if (status === 0) break;
		if (attempt === 3) process.exit(status ?? 1);
		console.log(`Publish failed, retrying in 60s (attempt ${attempt + 1}/3)`);
		await setTimeout(60_000);
	}
}
