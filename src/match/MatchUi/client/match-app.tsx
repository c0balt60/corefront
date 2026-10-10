import Vide from "@rbxts/vide";
import { useAtom } from "@rbxts/vide-charm";

import { hudVisibleAtom } from "core/Interface/client/ui-state";
import { MatchHud } from "match/Match/client/components/match-hud";
import { matchStateAtom } from "match/Match/client/match-state";

/**
 * Everything on screen that only exists in the match. Core's `App` still draws
 * the shared HUD and loading screen. This is where match features' components
 * are wired to their atoms and messages.
 */
export function MatchApp() {
	const visible = useAtom(hudVisibleAtom);

	return (
		<screengui Name="MatchApp" Enabled={visible} ResetOnSpawn={false}>
			<MatchHud state={useAtom(matchStateAtom)} />
		</screengui>
	);
}
