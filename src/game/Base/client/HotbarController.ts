import { Controller, OnStart } from "@flamework/core";
import { Players, StarterGui, UserInputService } from "@rbxts/services";

import { equippedAtom, toggleTool, toolsAtom } from "game/Base/client/base-state";
import { isBlaster } from "game/Base/shared/blasters";
import { BUILD_TOOL } from "game/Base/shared/buildings";
import { starMapOpenAtom } from "game/Planets/client/planets-state";

/** Hotbar order, after the Blaster. Tools not listed follow, by name. */
const TOOL_ORDER = [BUILD_TOOL];

/** The number keys, so the hotbar's nth slot is key n. */
const NUMBER_KEYS: ReadonlyArray<Enum.KeyCode> = [
	Enum.KeyCode.One,
	Enum.KeyCode.Two,
	Enum.KeyCode.Three,
	Enum.KeyCode.Four,
	Enum.KeyCode.Five,
	Enum.KeyCode.Six,
	Enum.KeyCode.Seven,
	Enum.KeyCode.Eight,
	Enum.KeyCode.Nine,
];

function rank(tool: Tool) {
	if (isBlaster(tool)) return 0;
	const index = TOOL_ORDER.indexOf(tool.Name);
	return index >= 0 ? index + 1 : TOOL_ORDER.size() + 1;
}

/**
 * Replaces Roblox's backpack with the game's own hotbar (`GameApp` draws it):
 * keeps `toolsAtom` and `equippedAtom` up to date as tools move between the
 * backpack and the character, and draws or puts away the nth tool on key n.
 */
@Controller()
export class HotbarController implements OnStart {
	onStart() {
		const player = Players.LocalPlayer;
		// Can fail while the core scripts are still loading, so it keeps trying.
		task.spawn(() => {
			while (!pcall(() => StarterGui.SetCoreGuiEnabled(Enum.CoreGuiType.Backpack, false))[0]) task.wait(0.5);
		});

		const refresh = () => {
			const character = player.Character;
			const held = character?.GetChildren() ?? [];
			const packed = player.FindFirstChildOfClass("Backpack")?.GetChildren() ?? [];
			const tools = [...packed, ...held].filter((child): child is Tool => child.IsA("Tool"));
			tools.sort((a, b) => (rank(a) !== rank(b) ? rank(a) < rank(b) : a.Name < b.Name));
			toolsAtom(tools);
			equippedAtom(character?.FindFirstChildOfClass("Tool"));
		};
		const watch = (container: Instance) => {
			container.ChildAdded.Connect(refresh);
			container.ChildRemoved.Connect(refresh);
		};
		const onCharacter = (character: Model) => {
			watch(character);
			// Every spawn brings a new backpack.
			watch(player.WaitForChild("Backpack"));
			refresh();
		};
		if (player.Character) task.spawn(onCharacter, player.Character);
		player.CharacterAdded.Connect(onCharacter);
		player.CharacterRemoving.Connect(() => task.defer(refresh));

		UserInputService.InputBegan.Connect((input, processed) => {
			if (processed || starMapOpenAtom() || UserInputService.GetFocusedTextBox()) return;
			const index = NUMBER_KEYS.indexOf(input.KeyCode);
			const tool = index >= 0 ? toolsAtom()[index] : undefined;
			if (tool) toggleTool(tool);
		});
	}
}
