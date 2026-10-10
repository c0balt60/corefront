import { Controller, OnStart } from "@flamework/core";
import { CmdrClient } from "@rbxts/cmdr";

/** Requiring CmdrClient is what creates the console UI. Permissions are checked on the server. */
@Controller()
export class CmdrController implements OnStart {
	onStart() {
		CmdrClient.SetActivationKeys([Enum.KeyCode.F2]);
	}
}
