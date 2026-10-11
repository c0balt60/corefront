import type { Planet, PlanetKind } from "core/Worlds/shared/star-system";

export type ResourceId = "copper" | "lead" | "coal" | "titanium" | "scrap" | "thorium";

export interface ResourceStack {
	readonly resource: ResourceId;
	readonly amount: number;
}

export const RESOURCES: Record<ResourceId, { readonly name: string; readonly color: Color3 }> = {
	copper: { name: "Copper", color: Color3.fromRGB(217, 140, 84) },
	lead: { name: "Lead", color: Color3.fromRGB(150, 150, 200) },
	coal: { name: "Coal", color: Color3.fromRGB(60, 60, 66) },
	titanium: { name: "Titanium", color: Color3.fromRGB(140, 195, 225) },
	scrap: { name: "Scrap", color: Color3.fromRGB(130, 118, 98) },
	thorium: { name: "Thorium", color: Color3.fromRGB(205, 105, 165) },
};

/** Display order, everywhere resources are listed. */
export const RESOURCE_ORDER: ReadonlyArray<ResourceId> = ["copper", "lead", "coal", "titanium", "scrap", "thorium"];

/**
 * The ores each kind of planet spawns, with relative weights. Copper and lead
 * are on every planet, so every planet can afford every building.
 */
export const KIND_ORES: Record<
	PlanetKind,
	ReadonlyArray<{ readonly resource: ResourceId; readonly weight: number }>
> = {
	Habitable: [
		{ resource: "copper", weight: 10 },
		{ resource: "lead", weight: 7 },
		{ resource: "coal", weight: 4 },
	],
	Barren: [
		{ resource: "copper", weight: 8 },
		{ resource: "lead", weight: 6 },
		{ resource: "scrap", weight: 6 },
		{ resource: "titanium", weight: 3 },
	],
	Frozen: [
		{ resource: "copper", weight: 8 },
		{ resource: "lead", weight: 8 },
		{ resource: "titanium", weight: 4 },
	],
	Volcanic: [
		{ resource: "copper", weight: 8 },
		{ resource: "lead", weight: 5 },
		{ resource: "coal", weight: 6 },
		{ resource: "thorium", weight: 2 },
	],
};

/** Most items one player carries, across every resource. */
export const INVENTORY_CAPACITY = 50;

/** Fuel per destination index, per point of an ore's weight. */
const FUEL_RATE = 1.5;

/**
 * The fuel a launch to planet `index` burns: every resource the planets before it
 * have, more of the common ones, and more the further out the destination is.
 * Planet 0 is free.
 */
export function travelCost(planets: ReadonlyArray<Planet>, index: number): Array<ResourceStack> {
	const weights = new Map<ResourceId, number>();
	for (let i = 0; i < index; i++) {
		for (const { resource, weight } of KIND_ORES[planets[i].kind]) {
			weights.set(resource, math.max(weights.get(resource) ?? 0, weight));
		}
	}
	return RESOURCE_ORDER.filter((resource) => weights.has(resource)).map((resource) => ({
		resource,
		amount: math.ceil(weights.get(resource)! * FUEL_RATE * index),
	}));
}
