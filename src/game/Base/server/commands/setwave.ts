import type { CommandDefinition } from "@rbxts/cmdr";

const command: CommandDefinition = {
	Name: "setwave",
	Description: "Sets how many waves have launched, so the next one is n + 1.",
	Group: "Admin",
	Args: [{ Type: "integer", Name: "wave", Description: "Waves launched so far." }],
};

export = command;
