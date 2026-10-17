import { Controller, OnStart } from "@flamework/core";
import { atom, effect } from "@rbxts/charm";
import { Players, TweenService, UserInputService, Workspace } from "@rbxts/services";

import { coreNow } from "game/Base/client/base-state";
import { starMapOpenAtom } from "game/Planets/client/planets-state";

/** Walk speed while sprinting, as a multiple of the Core's walk speed. */
const SPRINT_SPEED = 1.35;
/** Degrees the camera widens while sprinting. */
const SPRINT_FOV = 8;
const FOV_TWEEN = new TweenInfo(0.25, Enum.EasingStyle.Quad, Enum.EasingDirection.Out);
const SPRINT_KEYS: ReadonlyArray<Enum.KeyCode> = [Enum.KeyCode.LeftShift, Enum.KeyCode.RightShift];

/**
 * Owns the local character's walk speed: the Core's tier's, times
 * `SPRINT_SPEED` while Shift is held, when the camera also widens. Not while
 * the star map has the camera.
 */
@Controller()
export class SprintController implements OnStart {
	onStart() {
		// ponytail: keyboard only; touch and gamepad need their own sprint button.
		const player = Players.LocalPlayer;
		const humanoidAtom = atom<Humanoid | undefined>(undefined);
		const heldAtom = atom(false);
		const baseFov = Workspace.CurrentCamera?.FieldOfView ?? 70;

		const onCharacter = (character: Model) => humanoidAtom(character.WaitForChild("Humanoid") as Humanoid);
		if (player.Character) task.spawn(onCharacter, player.Character);
		player.CharacterAdded.Connect(onCharacter);

		UserInputService.InputBegan.Connect((input, processed) => {
			if (!processed && SPRINT_KEYS.includes(input.KeyCode)) heldAtom(true);
		});
		// Released even over UI, so it never sticks on.
		UserInputService.InputEnded.Connect((input) => {
			if (SPRINT_KEYS.includes(input.KeyCode)) heldAtom(false);
		});

		effect(() => {
			const humanoid = humanoidAtom();
			const sprinting = heldAtom() && humanoid !== undefined && !starMapOpenAtom();
			if (humanoid) humanoid.WalkSpeed = coreNow().walkSpeed * (sprinting ? SPRINT_SPEED : 1);
			const camera = Workspace.CurrentCamera;
			const fov = baseFov + (sprinting ? SPRINT_FOV : 0);
			if (camera) TweenService.Create(camera, FOV_TWEEN, { FieldOfView: fov }).Play();
		});
	}
}
