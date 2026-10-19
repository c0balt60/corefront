import type { Mission, PlanetKind } from "core/Worlds/shared/star-system";
import type { ResourceId } from "game/Base/shared/resources";
import type { Layout } from "game/Terrain/shared/layout";

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
	/** Where the Core, spawns, paths and cliff walls are. */
	readonly layout: Layout;
	/** Ground at `layout.core`, a cell corner on a flat pad: the Core's 2×2 cells meet here. */
	readonly landing: Vector3;
	/** The mission it was generated for. */
	readonly mission: Mission;
	/** The ground at each of `layout.spawns` when defending: drop zones. Empty when attacking, where the spawns are enemy base sites. */
	readonly dropZones: ReadonlyArray<Vector3>;
	readonly ores: ReadonlyArray<OreDeposit>;
	/** Trees, rocks and ore models. A building destroys the props it lands on. */
	readonly props: Folder;
	/** Ground height in studs, from the generated terrain itself (raycast after it was written). */
	readonly heightAt: (x: number, z: number) => number;
	/** Lowest and highest ground over the `size`×`size` cells with their -X/-Z corner on `cell`. */
	readonly groundRange: (cell: number, size: number) => readonly [low: number, high: number];
	/** Whether water or lava covers the ground here. Shallow water can be walked and built on. */
	isLiquid(x: number, z: number): boolean;
	/** Whether the liquid here is unbuildable and impassable: any lava, or water more than 3 studs deep. Never ice. */
	isDeep(x: number, z: number): boolean;
	/** Whether a cell is cliff or mountain: layout wall over 0.5, or more than 12 studs of height across it. Unbuildable and impassable. */
	cliff(cell: number): boolean;
}
