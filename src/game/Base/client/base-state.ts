import { atom } from "@rbxts/charm";

import type { BaseState } from "game/Base/shared/base-network";
import type { BuildableKind } from "game/Base/shared/buildings";
import { INVENTORY_CAPACITY, type ResourceId, type ResourceStack } from "game/Base/shared/resources";

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

/** What the local player carries. */
export const inventoryAtom = atom<Inventory>({ items: [], capacity: INVENTORY_CAPACITY });

/** Seconds a toast stays up. It fades out over the last `EXIT_TIME` of them. */
export const NOTICE_SECONDS = 4;

/** Toasts on screen, oldest first. Each is a fresh object, so `For` gives it its own row. */
export const noticesAtom = atom<ReadonlyArray<Notice>>([]);

export const buildModeAtom = atom<BuildMode>();

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
