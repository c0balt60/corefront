import { Controller, OnStart } from "@flamework/core";
import { effect } from "@rbxts/charm";

import { screenEffectIntensityAtom, screenEffectPulseAtom } from "core/Interface/client/ui-state";
import {
	baseStateAtom,
	coreAttackedAtom,
	inventoryAtom,
	NOTICE_SECONDS,
	type Notice,
	noticesAtom,
} from "game/Base/client/base-state";
import { BaseMessage, baseMessaging } from "game/Base/shared/base-network";
import { deployedAtom } from "game/Planets/client/planets-state";

/** The most toasts on screen at once. A new one pushes the oldest out. */
const MAX_NOTICES = 4;
/** Seconds after the Core's last hit that it still counts as under attack. */
const ATTACK_SECONDS = 3;
/** The red vignette while the Core is under attack: how strong, and how far it throbs. */
const ATTACK_INTENSITY = 0.5;
const ATTACK_PULSE = 0.6;

/** Keeps the mission atoms in sync with the server, and the vignette red while the Core is hit. `GameApp` draws them. */
@Controller()
export class BaseController implements OnStart {
	onStart() {
		let calm: thread | undefined;
		baseMessaging.client.on(BaseMessage.State, (state) => {
			const old = baseStateAtom();
			baseStateAtom(state);
			// Health falling on the same planet is a hit; a new planet's Core or a finished mission isn't.
			if (state.phase !== "active" || state.planet !== old?.planet) {
				coreAttackedAtom(false);
			} else if (deployedAtom() && state.coreHealth < old.coreHealth) {
				coreAttackedAtom(true);
				if (calm) task.cancel(calm);
				calm = task.delay(ATTACK_SECONDS, () => coreAttackedAtom(false));
			}
		});
		effect(() => {
			const attacked = coreAttackedAtom();
			screenEffectIntensityAtom(attacked ? ATTACK_INTENSITY : 0);
			screenEffectPulseAtom(attacked ? ATTACK_PULSE : 0);
		});
		baseMessaging.client.on(BaseMessage.Inventory, (inventory) => inventoryAtom(inventory));
		baseMessaging.client.on(BaseMessage.Notice, ({ text }) => {
			const notice: Notice = { text };
			noticesAtom((notices) => [...notices, notice].filter((_, index, all) => index >= all.size() - MAX_NOTICES));
			task.delay(NOTICE_SECONDS, () => noticesAtom((notices) => notices.filter((other) => other !== notice)));
		});
		baseMessaging.server.emit(BaseMessage.Request);
	}
}
