import { Controller, OnStart } from "@flamework/core";
import { ContextActionService, Workspace } from "@rbxts/services";

import { BaseMessage, baseMessaging } from "game/Base/shared/base-network";

/** Seconds a ping shows the aliens. */
const PING_SECONDS = 8;
/** The aliens' own red. */
const PING = Color3.fromRGB(255, 60, 50);

/**
 * Pings: G, middle click, the gamepad's d-pad up or the touch button shows every player every alien,
 * glowing red through walls, for `PING_SECONDS`. Pinging again keeps them showing. One Highlight over
 * the whole `Base.Aliens` model, however many aliens there are.
 */
@Controller()
export class PingController implements OnStart {
	onStart() {
		ContextActionService.BindAction(
			"Ping",
			(_, state) => {
				if (state === Enum.UserInputState.Begin) baseMessaging.server.emit(BaseMessage.Ping);
				return Enum.ContextActionResult.Pass;
			},
			true,
			Enum.KeyCode.G,
			Enum.UserInputType.MouseButton3,
			Enum.KeyCode.DPadUp,
		);
		ContextActionService.SetTitle("Ping", "Ping");

		const highlight = new Instance("Highlight");
		highlight.Enabled = false;
		highlight.FillColor = PING;
		highlight.OutlineColor = PING;
		highlight.FillTransparency = 0.75;
		highlight.DepthMode = Enum.HighlightDepthMode.AlwaysOnTop;
		task.spawn(() => {
			highlight.Parent = Workspace.WaitForChild("Base").WaitForChild("Aliens");
		});

		// Only the latest ping's timer turns it off.
		let pings = 0;
		baseMessaging.client.on(BaseMessage.Pinged, () => {
			const ping = ++pings;
			highlight.Enabled = true;
			task.delay(PING_SECONDS, () => {
				if (ping === pings) highlight.Enabled = false;
			});
		});
	}
}
