import type { PlanetKind } from "core/Worlds/shared/star-system";
import type { ResourceId } from "game/Base/shared/resources";

/** An infinite ore deposit on one cell. Its model is tagged "Ore" with `Resource` and `Cell` attributes. */
export interface OreDeposit {
	readonly resource: ResourceId;
	readonly cell: number;
	/** Ground point at the cell centre. */
	readonly position: Vector3;
	readonly model: Model;
}

/** A generated planet, as `TerrainService.mapAtom` hands it to gameplay. */
export interface PlanetMap {
	/** Bumps on every generation, so stale work can tell. */
	readonly epoch: number;
	/** Index into `generateStarSystem(seed).planets`. */
	readonly planet: number;
	readonly kind: PlanetKind;
	/** Ground at the map centre (0, y, 0), a cell corner on a flat pad: the Core's 2×2 cells meet here. */
	readonly landing: Vector3;
	/** Ground points on flat pads near the map edge, where waves come from. */
	readonly alienSpawns: ReadonlyArray<Vector3>;
	readonly ores: ReadonlyArray<OreDeposit>;
	/** Trees, rocks and ore models. A building destroys the props it lands on. */
	readonly props: Folder;
	/** Ground height in studs, from the generated terrain itself (raycast after it was written). */
	readonly heightAt: (x: number, z: number) => number;
	/** Lowest and highest ground over the `size`×`size` cells with their -X/-Z corner on `cell`. */
	readonly groundRange: (cell: number, size: number) => readonly [low: number, high: number];
	/** Whether water or lava covers the ground here (nothing builds or walks there). */
	isLiquid(x: number, z: number): boolean;
}
