import type { CommandDefinition } from "@rbxts/cmdr";

const command: CommandDefinition = {
	Name: "spawnaliens",
	Description: "Spawns aliens at the alien spawns, as if a wave sent them, or in front of a player.",
	Group: "Admin",
	Args: [
		{ Type: "string", Name: "kind", Description: "crawler, brute or spitter." },
		{ Type: "integer", Name: "count", Description: "How many." },
		{ Type: "player", Name: "near", Description: "Spawn them in front of this player instead.", Optional: true },
	],
};

export = command;
