import { Controller, OnStart } from "@flamework/core";
import { Workspace } from "@rbxts/services";

/** What an enemy's and a derelict's buildings are tinted towards (see `Team`), and how far. */
const ENEMY = Color3.fromRGB(200, 40, 40);
const DERELICT = Color3.fromRGB(110, 92, 72);
const TINT = 0.55;

/**
 * Tints every enemy building red and every derelict one grey-brown, by its model's `Team` attribute, so
 * they read at a glance. Its parts are tinted as they appear, as a building is remade whenever it
 * turns or its neighbours change. Neon stays lit, and the player's own are left as they are.
 */
@Controller()
export class TeamController implements OnStart {
	onStart() {
		task.spawn(() => {
			const buildings = Workspace.WaitForChild("Base").WaitForChild("Buildings");
			const watch = (model: Instance) => {
				const team = model.GetAttribute("Team");
				const tint = team === "enemy" ? ENEMY : team === "derelict" ? DERELICT : undefined;
				if (!model.IsA("Model") || tint === undefined) return;
				const paint = (part: Instance) => {
					if (part.IsA("BasePart") && part.Material !== Enum.Material.Neon) {
						part.Color = part.Color.Lerp(tint, TINT);
					}
				};
				for (const part of model.GetDescendants()) paint(part);
				model.DescendantAdded.Connect(paint);
			};
			for (const child of buildings.GetChildren()) watch(child);
			buildings.ChildAdded.Connect(watch);
		});
	}
}
