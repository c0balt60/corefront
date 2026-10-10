import type { CommandDefinition } from "@rbxts/cmdr";

const command: CommandDefinition = {
	Name: "coins",
	Description: "Adds coins to a player.",
	Group: "Admin",
	Args: [
		{ Type: "player", Name: "player", Description: "The player to give coins to." },
		{ Type: "integer", Name: "amount", Description: "How many coins to add. Negative removes." },
	],
};

export = command;
