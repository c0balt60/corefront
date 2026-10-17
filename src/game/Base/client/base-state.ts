import { atom } from "@rbxts/charm";
import { Players } from "@rbxts/services";

import type { BaseState } from "game/Base/shared/base-network";
import { blasterOf, type BlasterKind } from "game/Base/shared/blasters";
import { type BuildableKind, coreStats, type CoreDef } from "game/Base/shared/buildings";
import type { ResourceId, ResourceStack } from "game/Base/shared/resources";

export interface Inventory {
	readonly items: ReadonlyArray<ResourceStack>;
	readonly capacity: number;
}

/** What a toast is about, which sets its band's colour: the server's warnings and refusals, waves, and research. */
export type NoticeKind = "alert" | "wave" | "research";

export interface Notice {
	readonly text: string;
	readonly kind: NoticeKind;
}

/** What the build bar has picked: a building to place, `remove` to take buildings down, or nothing. */
export type BuildMode = BuildableKind | "remove";

/** The mission as the server last described it. `undefined` until it first answers. */
export const baseStateAtom = atom<BaseState>();

/** Whether a ping is showing every alien (see `PingController`), so none is hidden for being far off. */
export const pingedAtom = atom(false);

/** The wave whose launch is being announced across the screen (`BaseController` sets it), if any. */
export const waveBannerAtom = atom<number>();

/** Whether the Core has taken a hit in the last few seconds (`BaseController` sets it), while the local player is deployed. */
export const coreAttackedAtom = atom(false);

/** What the local player carries. */
export const inventoryAtom = atom<Inventory>({ items: [], capacity: coreStats("core").carry });

/** What the Core's tier gives the local character (see `CoreDef`): a Shard's until the server says. */
export function coreNow(): CoreDef {
	return coreStats(baseStateAtom()?.core ?? "core");
}

/** The local player's `Blaster` attribute, as `BlasterController` last saw it: the Blaster they picked at the Core. */
export const pickedBlasterAtom = atom<unknown>();

/** The Blaster the local character fires (see `blasterOf`). */
export function blasterNow(): BlasterKind {
	return blasterOf(pickedBlasterAtom(), baseStateAtom()?.core ?? "core");
}

/** Seconds a toast stays up. It fades out over the last `EXIT_TIME` of them. */
export const NOTICE_SECONDS = 4;

/** Toasts on screen, oldest first. Each is a fresh object, so `For` gives it its own row. */
export const noticesAtom = atom<ReadonlyArray<Notice>>([]);

/** The most toasts on screen at once. A new one pushes the oldest out. */
const MAX_NOTICES = 4;

/** Puts up a toast for `NOTICE_SECONDS`. */
export function notify(text: string, kind: NoticeKind = "alert") {
	const notice: Notice = { text, kind };
	noticesAtom((notices) => [...notices, notice].filter((_, index, all) => index >= all.size() - MAX_NOTICES));
	task.delay(NOTICE_SECONDS, () => noticesAtom((notices) => notices.filter((other) => other !== notice)));
}

export const buildModeAtom = atom<BuildMode>();

/** The building whose panel is open, picked by clicking it. */
export const selectedAtom = atom<Model>();
/** The turret whose info page is open, from its panel's ? button. */
export const infoAtom = atom<BuildableKind>();
/** Whether the local player is within `TRANSFER_RANGE` of it, to move items in or out. */
export const nearSelectedAtom = atom(false);
/** The ore drawn on it, if it's a belt, back to front. */
export const selectedOreAtom = atom<ReadonlyArray<ResourceId>>([]);

/** The local character's tools in hotbar order, wherever they are (backpack or hand), and the one it has out. */
export const toolsAtom = atom<ReadonlyArray<Tool>>([]);
export const equippedAtom = atom<Tool>();

/** Draws `tool`, or puts it away when it's already out. */
export function toggleTool(tool: Tool) {
	const humanoid = Players.LocalPlayer.Character?.FindFirstChildOfClass("Humanoid");
	if (!humanoid) return;
	if (equippedAtom() === tool) humanoid.UnequipTools();
	else humanoid.EquipTool(tool);
}

/** Picks `mode`, or puts it down when it is already picked. */
export function toggleBuildMode(mode: BuildMode) {
	buildModeAtom((current) => (current === mode ? undefined : mode));
}

/** How much of `resource` the stacks hold. */
export function amountOf(stacks: ReadonlyArray<ResourceStack>, resource: ResourceId) {
	return stacks.find((stack) => stack.resource === resource)?.amount ?? 0;
}

export function canAfford(pool: ReadonlyArray<ResourceStack>, cost: ReadonlyArray<ResourceStack>) {
	return cost.every((stack) => amountOf(pool, stack.resource) >= stack.amount);
}
