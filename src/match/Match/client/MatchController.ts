import { Controller, OnStart } from "@flamework/core";

import { matchStateAtom } from "match/Match/client/match-state";
import { MatchMessage, matchMessaging } from "match/Match/shared/match-network";

/** Keeps `matchStateAtom` in sync with the server. The HUD is mounted by `MatchUiController`. */
@Controller()
export class MatchController implements OnStart {
	onStart() {
		matchMessaging.client.on(MatchMessage.State, (state) => matchStateAtom(state));
		matchMessaging.server.emit(MatchMessage.Request);
	}
}
