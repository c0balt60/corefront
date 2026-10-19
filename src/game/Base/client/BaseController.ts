import { Controller, OnStart } from "@flamework/core";
import { effect } from "@rbxts/charm";
import { Workspace } from "@rbxts/services";

import { screenEffectIntensityAtom, screenEffectPulseAtom } from "core/Interface/client/ui-state";
import { baseStateAtom, coreAttackedAtom, inventoryAtom, notify, waveBannerAtom } from "game/Base/client/base-state";
import { BaseMessage, baseMessaging } from "game/Base/shared/base-network";
import { deployedAtom } from "game/Planets/client/planets-state";

/** Seconds after the Core's last hit that it still counts as under attack. */
const ATTACK_SECONDS = 3;
/** The red vignette while the Core is under attack: how strong, and how far it throbs. */
const ATTACK_INTENSITY = 0.5;
const ATTACK_PULSE = 0.6;
/** Seconds a wave's banner stays up, and how long before a wave a toast warns of it. */
const BANNER_SECONDS = 3;
const WARN_SECONDS = 10;

/**
 * Keeps the mission atoms in sync with the server, the vignette red while the Core is hit, and
 * announces each wave: a toast `WARN_SECONDS` before, and a banner as it launches. `GameApp` draws them.
 */
@Controller()
export class BaseController implements OnStart {
	onStart() {
		let calm: thread | undefined;
		let warn: thread | undefined;
		let unbanner: thread | undefined;
		baseMessaging.client.on(BaseMessage.State, (state) => {
			const old = baseStateAtom();
			baseStateAtom(state);
			if (state.nextWaveAt !== old?.nextWaveAt) {
				if (warn) task.cancel(warn);
				const wait = state.nextWaveAt - Workspace.GetServerTimeNow() - WARN_SECONDS;
				const coming = state.wave + 1;
				warn =
					wait > 0
						? task.delay(wait, () => notify(`Wave ${coming} incoming in ${WARN_SECONDS} seconds.`, "wave"))
						: undefined;
			}
			if (state.phase === "active" && state.planet === old?.planet && state.wave > old.wave) {
				waveBannerAtom(state.wave);
				if (unbanner) task.cancel(unbanner);
				unbanner = task.delay(BANNER_SECONDS, () => waveBannerAtom(undefined));
			}
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
		baseMessaging.client.on(BaseMessage.Notice, ({ text }) => notify(text));
		baseMessaging.server.emit(BaseMessage.Request);
	}
}
