import type { CommandDefinition } from "@rbxts/cmdr";

const command: CommandDefinition = {
	Name: "giveinv",
	Description: "Puts resources in a player's inventory, up to its capacity.",
	Group: "Admin",
	Args: [
		{ Type: "player", Name: "player", Description: "Whose inventory." },
		{ Type: "string", Name: "resource", Description: "copper, lead, coal, titanium, scrap or thorium." },
		{ Type: "integer", Name: "amount", Description: "How many to give." },
	],
};

export = command;
