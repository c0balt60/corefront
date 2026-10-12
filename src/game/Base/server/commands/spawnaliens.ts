import type { CommandDefinition } from "@rbxts/cmdr";

const command: CommandDefinition = {
	Name: "spawnaliens",
	Description: "Spawns aliens in the drop zones, as if a wave sent them, or in front of a player.",
	Group: "Admin",
	Args: [
		{
			Type: "string",
			Name: "kind",
			Description: "An alien kind, like crawler, titan or drone. A wrong one lists them all.",
		},
		{ Type: "integer", Name: "count", Description: "How many." },
		{ Type: "player", Name: "near", Description: "Spawn them in front of this player instead.", Optional: true },
	],
};

export = command;
