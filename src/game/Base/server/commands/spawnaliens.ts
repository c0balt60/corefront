import type { CommandDefinition } from "@rbxts/cmdr";

const command: CommandDefinition = {
	Name: "spawnaliens",
	Description: "Spawns aliens at the alien spawns, as if a wave sent them.",
	Group: "Admin",
	Args: [
		{ Type: "string", Name: "kind", Description: "crawler, brute or spitter." },
		{ Type: "integer", Name: "count", Description: "How many." },
	],
};

export = command;
