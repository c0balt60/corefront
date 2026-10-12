import { atom } from "@rbxts/charm";
import { Players } from "@rbxts/services";

import type { BaseState } from "game/Base/shared/base-network";
import type { BuildableKind } from "game/Base/shared/buildings";
import type { ResourceId, ResourceStack } from "game/Base/shared/resources";
import { STATS } from "game/Research/shared/research";

export interface Inventory {
	readonly items: ReadonlyArray<ResourceStack>;
	readonly capacity: number;
}

export interface Notice {
	readonly text: string;
}

/** What the build bar has picked: a building to place, `remove` to take buildings down, or nothing. */
export type BuildMode = BuildableKind | "remove";

/** The mission as the server last described it. `undefined` until it first answers. */
export const baseStateAtom = atom<BaseState>();

/** Whether the Core has taken a hit in the last few seconds (`BaseController` sets it), while the local player is deployed. */
export const coreAttackedAtom = atom(false);

/** What the local player carries. */
export const inventoryAtom = atom<Inventory>({ items: [], capacity: STATS.carryCapacity.base });

/** Seconds a toast stays up. It fades out over the last `EXIT_TIME` of them. */
export const NOTICE_SECONDS = 4;

/** Toasts on screen, oldest first. Each is a fresh object, so `For` gives it its own row. */
export const noticesAtom = atom<ReadonlyArray<Notice>>([]);

export const buildModeAtom = atom<BuildMode>();

/** The building whose panel is open, picked by clicking it. */
export const selectedAtom = atom<Model>();
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
