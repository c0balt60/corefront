// Publishes every built place to one environment: `node scripts/publish.mjs staging`.
// Run `pnpm build` first, and set RBXCLOUD_API_KEY.
import { spawnSync } from "node:child_process";

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
	if (status !== 0) process.exit(status ?? 1);
}
