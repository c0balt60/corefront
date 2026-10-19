import type { CommandDefinition } from "@rbxts/cmdr";

const command: CommandDefinition = {
	Name: "giveresource",
	Description: "Adds resources to the Core's pool on the active planet.",
	Group: "Admin",
	Args: [
		{ Type: "string", Name: "resource", Description: "copper, lead, coal, titanium, scrap or thorium." },
		{ Type: "integer", Name: "amount", Description: "How many to add. Negative removes." },
	],
};

export = command;
