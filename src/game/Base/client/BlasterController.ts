import { Controller, OnStart } from "@flamework/core";
import { Players, UserInputService, Workspace } from "@rbxts/services";

import { BaseMessage, baseMessaging } from "game/Base/shared/base-network";
import { levelsAtom } from "game/Research/client/research-state";
import { statValue } from "game/Research/shared/research";

/** Added to the server's cooldown between shots, so ordinary jitter doesn't drop shots. */
const FIRE_SLACK = 0.02;
/** How far the Blaster aims, in studs. Past anything, it aims at the end of this. */
const AIM_RANGE = 300;

/** Where the mouse points: the first thing under it that isn't the character, or `AIM_RANGE` along its ray. */
function aim(character: Model) {
	const camera = Workspace.CurrentCamera;
	if (!camera) return undefined;
	const mouse = UserInputService.GetMouseLocation();
	const ray = camera.ViewportPointToRay(mouse.X, mouse.Y);

	const params = new RaycastParams();
	params.FilterType = Enum.RaycastFilterType.Exclude;
	params.FilterDescendantsInstances = [character];
	const reach = ray.Direction.mul(AIM_RANGE);
	return Workspace.Raycast(ray.Origin, reach, params)?.Position ?? ray.Origin.add(reach);
}

/**
 * Fires the server's Blaster: while the character has it out and the button is
 * held, tells the server where the mouse points once per researched cooldown. The
 * server raycasts from the Blaster itself and decides what it hits.
 */
@Controller()
export class BlasterController implements OnStart {
	private readonly hooked = new Set<Tool>();

	onStart() {
		const player = Players.LocalPlayer;
		// A tool is parented to the character while it's out, so this sees the Blaster every time it's drawn.
		const watch = (character: Model) => {
			const check = (child: Instance) => {
				if (child.IsA("Tool") && child.Name === "Blaster") this.hook(child, character);
			};
			character.GetChildren().forEach(check);
			character.ChildAdded.Connect(check);
		};

		if (player.Character) watch(player.Character);
		player.CharacterAdded.Connect(watch);
	}

	private hook(tool: Tool, character: Model) {
		if (this.hooked.has(tool)) return;
		this.hooked.add(tool);
		tool.Destroying.Connect(() => this.hooked.delete(tool));

		let held = false;
		let firing = false;
		const release = () => {
			held = false;
		};
		tool.Deactivated.Connect(release);
		tool.Unequipped.Connect(release);
		tool.Activated.Connect(() => {
			held = true;
			// One loop at a time, so clicking faster than it fires can't fire faster.
			if (firing) return;
			firing = true;
			task.spawn(() => {
				while (held && tool.Parent === character) {
					const target = aim(character);
					if (target) baseMessaging.server.emit(BaseMessage.Fire, { target });
					task.wait(statValue(levelsAtom(), "blasterCooldown") + FIRE_SLACK);
				}
				firing = false;
			});
		});
	}
}
