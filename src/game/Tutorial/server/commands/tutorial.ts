import type { CommandDefinition } from "@rbxts/cmdr";

const command: CommandDefinition = {
	Name: "tutorial",
	Description: "Moves a player's tutorial to a step, finishes it, or starts it over.",
	Group: "Admin",
	Args: [
		{ Type: "player", Name: "player", Description: "Whose tutorial." },
		{
			Type: "string",
			Name: "step",
			Description: "A step like deploy, drill or shoot, or done, or reset. A wrong one lists them all.",
		},
	],
};

export = command;
