import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import type { Logger } from "@rbxts/log";
import { Players } from "@rbxts/services";
import { promiseTree } from "@rbxts/validate-tree";

import { type CharacterRig, CharacterSchema } from "core/Character/shared/character";

/**
 * Waits for the local character to match `CharacterSchema`, then exposes it
 * fully typed. Everything bound to a character goes in the janitor, which is
 * cleaned when the character is replaced or removed.
 */
@Controller()
export class CharacterController implements OnStart {
	private readonly janitor = new Janitor();
	private rig: CharacterRig | undefined;

	constructor(private readonly logger: Logger) {}

	onStart() {
		const player = Players.LocalPlayer;
		if (player.Character) this.onCharacterAdded(player.Character);
		player.CharacterAdded.Connect((character) => this.onCharacterAdded(character));
		player.CharacterRemoving.Connect(() => this.janitor.Cleanup());
	}

	/** The local character, or `undefined` while there is none. */
	getRig(): CharacterRig | undefined {
		return this.rig;
	}

	private onCharacterAdded(character: Model) {
		this.janitor.Cleanup();
		this.janitor.Add(() => (this.rig = undefined), true);

		this.janitor.AddPromise(promiseTree(character, CharacterSchema)).then((rig) => {
			this.rig = rig;
			this.janitor.Add(rig.Humanoid.Died.Connect(() => this.logger.Debug("Character died")));
		});
	}
}
