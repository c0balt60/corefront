import { OnStart, Service } from "@flamework/core";
import { atom, computed } from "@rbxts/charm";
import { Cmdr } from "@rbxts/cmdr";
import type { Logger } from "@rbxts/log";
import { CollectionService, Players, StarterPack, Workspace } from "@rbxts/services";
import { t } from "@rbxts/t";

import { buildingModel, setHealth } from "game/Base/server/models";
import { BaseMessage, baseMessaging, type Phase } from "game/Base/shared/base-network";
import { BUILD_RANGE, BUILD_TOOL, BUILDINGS, type BuildingKind, REFUND } from "game/Base/shared/buildings";
import {
	INVENTORY_CAPACITY,
	KIND_ORES,
	RESOURCE_ORDER,
	RESOURCES,
	type ResourceId,
	type ResourceStack,
} from "game/Base/shared/resources";
import { PlanetsService } from "game/Planets/server/PlanetsService";
import type { OreDeposit, PlanetMap } from "game/Terrain/server/planet-map";
import { CELL_STUDS, cellAt, cellCenter, cellCoords, cellIndex, GRID_SIZE } from "game/Terrain/shared/map";

/** Resource amounts by id. A missing key is zero. */
export type Stock = Partial<Record<ResourceId, number>>;

/** A building on the map. Its model carries the same facts as attributes, for the client. */
export interface Building {
	readonly kind: BuildingKind;
	readonly model: Model;
	/** The -X/-Z corner cell. */
	readonly cell: number;
	/** The body's centre: what range checks and shots use. */
	readonly position: Vector3;
	/** Quarter turns, 0-3. */
	readonly rotation: number;
	health: number;
	/** Drills: what they mine. */
	readonly resource?: ResourceId;
	/** Drills: mined and waiting to be collected. */
	stored: number;
	/** Turrets: the part that turns to aim. */
	readonly head?: BasePart;
}

/** A liberated planet's base while the team is away: everything but the Core, which left with them. */
interface SavedBase {
	readonly buildings: ReadonlyArray<Pick<Building, "kind" | "cell" | "rotation" | "health" | "stored">>;
	/** What stayed in storage: whatever wasn't loaded as cargo or burnt as fuel. */
	readonly pool: Stock;
}

/** The pool of a fresh start, with nothing saved and no cargo coming. */
const START_POOL: Stock = { copper: 40, lead: 20 };
const MINE_AMOUNT = 3;
const MINE_SECONDS = 0.8;
const DRILL_SECONDS = 2;
const DRILL_CAPACITY = 30;
/** Buildings keep this many cells clear of an alien spawn, so waves can't be walled in at the source. */
const SPAWN_CLEARANCE = 3;
/** Most height difference across a footprint, in studs. */
const MAX_SLOPE = 6;
/** How far a foundation's top stands above the highest ground under it, so it never shares a plane with the terrain. */
const GROUND_CLEARANCE = 0.5;
const FULL = "Your pack is full. Deposit at the Core.";

const isPlaceData = t.interface({
	kind: t.literal("drill", "wall", "turret"),
	x: t.integer,
	z: t.integer,
	rotation: t.integer,
});
const isRemoveData = t.interface({ x: t.integer, z: t.integer });

function makeFolder(name: string, parent: Instance): Folder {
	const instance = new Instance("Folder");
	instance.Name = name;
	instance.Parent = parent;
	return instance;
}

/** The cells a `size`×`size` building with its -X/-Z corner on `cell` covers. */
function footprint(cell: number, size: number): Array<number> {
	const [gx, gz] = cellCoords(cell);
	const cells = new Array<number>();
	for (let dz = 0; dz < size; dz++) for (let dx = 0; dx < size; dx++) cells.push(cellIndex(gx + dx, gz + dz));
	return cells;
}

function prompt(parent: Instance, name: string, object: string, hold: number, distance = 10): ProximityPrompt {
	const instance = new Instance("ProximityPrompt");
	instance.Name = name;
	instance.ActionText = name;
	instance.ObjectText = object;
	instance.HoldDuration = hold;
	instance.MaxActivationDistance = distance;
	instance.RequiresLineOfSight = false;
	instance.Parent = parent;
	return instance;
}

/**
 * The team's base on the active planet: the Core and its shared pool, every
 * player's carried inventory, buildings and their placement rules, and the
 * Mine, Collect and Deposit prompts. `WaveService` drives it: it calls
 * {@link BaseService.reset} for each new planet and attacks what is built here.
 */
@Service()
export class BaseService implements OnStart {
	/** The Core's pool: this planet's resources, zeros included. Only this service writes it. */
	readonly poolAtom = atom<Stock>({});
	readonly coreHealthAtom = atom(0);
	/** How the mission on the active planet ended, while its banner shows. `WaveService` clears it. */
	readonly resultAtom = atom<"won" | "lost">();
	readonly phase = computed((): Phase => {
		if (this.planetsService.activeAtom() === undefined) return "idle";
		if (this.planetsService.travelAtom()) return "travelling";
		if (!this.planetsService.currentMap()) return "generating";
		return this.resultAtom() ?? "active";
	});

	readonly folder = makeFolder("Base", Workspace);
	readonly buildingsFolder = makeFolder("Buildings", this.folder);
	readonly aliensFolder = makeFolder("Aliens", this.folder);

	readonly buildings = new Set<Building>();
	/** The building covering each cell. */
	readonly cells = new Map<number, Building>();
	/** Bumps whenever a building appears or goes, so the flowfield knows to rebuild. */
	revision = 0;
	core?: Building;

	private map?: PlanetMap;
	private readonly ores = new Map<number, OreDeposit>();
	private readonly minePrompts = new Map<number, ProximityPrompt>();
	private spawnCells = new Array<readonly [number, number]>();
	private readonly inventories = new Map<Player, Stock>();
	/** Liberated planets' bases, while the team is elsewhere. */
	private readonly saved = new Map<number, SavedBase>();
	/** The cargo on its way, and where to. */
	private arrival?: { readonly planet: number; readonly cargo: Stock };

	constructor(
		private readonly logger: Logger,
		private readonly planetsService: PlanetsService,
	) {}

	onStart() {
		baseMessaging.server.on(BaseMessage.Place, (player, data) => this.place(player, data));
		baseMessaging.server.on(BaseMessage.Remove, (player, data) => this.remove(player, data));

		// No handle: it only tells the client to show the build bar.
		const tool = new Instance("Tool");
		tool.Name = BUILD_TOOL;
		tool.RequiresHandle = false;
		tool.CanBeDropped = false;
		tool.ToolTip = "Build and remove";
		tool.Parent = StarterPack;

		// What a player carries is lost when they die.
		const watch = (player: Player) =>
			player.CharacterAdded.Connect((character) => {
				const humanoid = character.WaitForChild("Humanoid") as Humanoid;
				humanoid.Died.Connect(() => this.setInventory(player, {}));
			});
		Players.GetPlayers().forEach(watch);
		Players.PlayerAdded.Connect(watch);
		Players.PlayerRemoving.Connect((player) => this.inventories.delete(player));

		task.spawn(() => {
			while (true) {
				task.wait(DRILL_SECONDS);
				if (this.phase() === "active") this.runDrills();
			}
		});

		Cmdr.Registry.RegisterCommandsIn(script.Parent!.WaitForChild("commands"));
	}

	/**
	 * Clears the base and, given a map, starts one on it: a Core at the landing
	 * and Mine prompts on every ore, plus the planet's saved base if it has one.
	 * The pool is what was saved plus any cargo landing here; with neither, the
	 * starting pool. Everyone's inventory is emptied either way.
	 */
	reset(map: PlanetMap | undefined) {
		for (const building of this.buildings) building.model.Destroy();
		this.buildings.clear();
		this.cells.clear();
		this.core = undefined;
		this.revision++;
		for (const [, minePrompt] of this.minePrompts) minePrompt.Destroy();
		this.minePrompts.clear();
		this.ores.clear();
		for (const player of Players.GetPlayers()) this.setInventory(player, {});
		this.resultAtom(undefined);

		this.map = map;
		if (!map) {
			this.spawnCells = [];
			this.poolAtom({});
			this.coreHealthAtom(0);
			return;
		}

		const saved = this.saved.get(map.planet);
		this.saved.delete(map.planet);
		const arrival = this.arrival?.planet === map.planet ? this.arrival : undefined;
		this.arrival = undefined;
		const pool: Stock = {};
		for (const { resource } of KIND_ORES[map.kind]) pool[resource] = 0;
		const sources = saved || arrival ? [saved?.pool ?? {}, arrival?.cargo ?? {}] : [START_POOL];
		for (const stock of sources) {
			for (const [resource, amount] of pairs(stock)) pool[resource] = (pool[resource] ?? 0) + amount;
		}
		this.poolAtom(pool);

		this.spawnCells = [];
		for (const spawn of map.alienSpawns) {
			const cell = cellAt(spawn.X, spawn.Z);
			if (cell !== undefined) this.spawnCells.push(cellCoords(cell));
		}

		for (const ore of map.ores) {
			this.ores.set(ore.cell, ore);
			const part = ore.model.PrimaryPart ?? ore.model.FindFirstChildWhichIsA("BasePart", true);
			if (!part) continue;
			const minePrompt = prompt(part, "Mine", RESOURCES[ore.resource].name, MINE_SECONDS);
			minePrompt.Triggered.Connect((player) => this.mine(player, ore.resource));
			this.minePrompts.set(ore.cell, minePrompt);
		}

		// The landing is a cell corner: the Core's 2×2 cells meet on it.
		const corner = cellAt(map.landing.X - CELL_STUDS / 2, map.landing.Z - CELL_STUDS / 2);
		if (corner !== undefined) this.core = this.build(map, "core", corner, 0);
		this.coreHealthAtom(BUILDINGS.core.health);

		for (const old of saved?.buildings ?? []) {
			const building = this.build(map, old.kind, old.cell, old.rotation);
			building.health = old.health;
			building.stored = old.stored;
			setHealth(building.model, old.health, BUILDINGS[old.kind].health);
			if (building.resource !== undefined) building.model.SetAttribute("Stored", old.stored);
		}
	}

	/** Keeps the active planet's base, all but the Core, for when the team comes back to `planet`. */
	save(planet: number) {
		const buildings = new Array<SavedBase["buildings"][number]>();
		for (const { kind, cell, rotation, health, stored } of this.buildings) {
			if (kind !== "core") buildings.push({ kind, cell, rotation, health, stored });
		}
		this.saved.set(planet, { buildings, pool: { ...this.poolAtom() } });
	}

	/** Cargo to add to the pool when `planet`'s base next starts. */
	expect(planet: number, cargo: ReadonlyArray<ResourceStack>) {
		const stock: Stock = {};
		for (const { resource, amount } of cargo) stock[resource] = (stock[resource] ?? 0) + amount;
		this.arrival = { planet, cargo: stock };
	}

	/** Whether the pool holds every stack, counting repeats of a resource together. */
	canSpend(stacks: ReadonlyArray<ResourceStack>): boolean {
		const need: Stock = {};
		for (const { resource, amount } of stacks) need[resource] = (need[resource] ?? 0) + amount;
		const pool = this.poolAtom();
		for (const [resource, amount] of pairs(need)) if ((pool[resource] ?? 0) < amount) return false;
		return true;
	}

	/** Takes the stacks out of the pool. Check `canSpend` first. */
	spend(stacks: ReadonlyArray<ResourceStack>) {
		this.pay(stacks, -1);
	}

	/** Ends the mission on the active planet; `WaveService` shows the result, then moves on. False when none is running. */
	end(result: "won" | "lost"): boolean {
		if (this.phase() !== "active") return false;
		this.logger.Info("Planet {Planet} {Result}", this.map?.planet, result);
		this.resultAtom(result);
		return true;
	}

	/** Hurts a building. At zero it is gone for good, and losing the Core loses the planet. */
	damage(building: Building, amount: number) {
		if (!this.buildings.has(building)) return;
		building.health = math.max(building.health - amount, 0);
		setHealth(building.model, building.health, BUILDINGS[building.kind].health);
		if (building === this.core) this.coreHealthAtom(building.health);
		if (building.health > 0) return;

		this.demolish(building);
		if (building.kind === "core") this.end("lost");
	}

	/** Adds to (or, negative, takes from) the pool. False if this planet has no such resource. */
	addToPool(resource: ResourceId, amount: number): boolean {
		if (this.poolAtom()[resource] === undefined) return false;
		this.pay([{ resource, amount }], 1);
		return true;
	}

	/** Puts up to `amount` into a player's inventory, within its capacity. Returns how many fit. */
	give(player: Player, resource: ResourceId, amount: number): number {
		const items = this.inventories.get(player) ?? {};
		let carried = 0;
		for (const [, count] of pairs(items)) carried += count;
		const given = math.max(0, math.min(amount, INVENTORY_CAPACITY - carried));
		if (given > 0) this.setInventory(player, { ...items, [resource]: (items[resource] ?? 0) + given });
		return given;
	}

	sendInventory(player: Player) {
		const items = this.inventories.get(player) ?? {};
		baseMessaging.client.emit(player, BaseMessage.Inventory, {
			items: RESOURCE_ORDER.filter((resource) => (items[resource] ?? 0) > 0).map((resource) => ({
				resource,
				amount: items[resource]!,
			})),
			capacity: INVENTORY_CAPACITY,
		});
	}

	notify(player: Player, text: string) {
		baseMessaging.client.emit(player, BaseMessage.Notice, { text });
	}

	private setInventory(player: Player, items: Stock) {
		this.inventories.set(player, items);
		this.sendInventory(player);
	}

	/** Adds each stack, scaled, to the pool: -1 spends a cost, `REFUND` gives part of it back. */
	private pay(stacks: ReadonlyArray<ResourceStack>, scale: number) {
		const pool = { ...this.poolAtom() };
		for (const { resource, amount } of stacks) pool[resource] = (pool[resource] ?? 0) + math.floor(amount * scale);
		this.poolAtom(pool);
	}

	private place(player: Player, data: unknown) {
		if (!isPlaceData(data)) return;
		const refuse = (text: string) => this.notify(player, text);
		const map = this.map;
		const def = BUILDINGS[data.kind];
		if (!map || this.phase() !== "active") return refuse("You can't build right now.");
		if (!this.inReach(player, cellCenter(cellIndex(data.x, data.z), def.size))) {
			return refuse("That's too far away to build.");
		}
		if (data.x < 0 || data.z < 0 || data.x + def.size > GRID_SIZE || data.z + def.size > GRID_SIZE) {
			return refuse("That's off the map.");
		}

		const cell = cellIndex(data.x, data.z);
		const cells = footprint(cell, def.size);
		if (cells.some((covered) => this.cells.has(covered))) return refuse("Something is already built there.");
		if (cells.some((covered) => this.nearSpawn(covered))) return refuse("Too close to an alien spawn.");
		if (cells.some((covered) => map.isLiquid(cellCenter(covered).X, cellCenter(covered).Z))) {
			return refuse("You can't build on liquid.");
		}
		const [low, high] = map.groundRange(cell, def.size);
		if (high - low > MAX_SLOPE) return refuse("The ground is too steep there.");
		if (data.kind === "drill" && !this.ores.has(cell)) return refuse("Drills must go on ore.");
		const pool = this.poolAtom();
		const missing = def.cost.find(({ resource, amount }) => (pool[resource] ?? 0) < amount);
		if (missing) return refuse(`Not enough ${RESOURCES[missing.resource].name}.`);

		this.pay(def.cost, -1);
		this.build(map, data.kind, cell, data.rotation % 4);
	}

	private remove(player: Player, data: unknown) {
		if (!isRemoveData(data)) return;
		const refuse = (text: string) => this.notify(player, text);
		const map = this.map;
		if (!map || this.phase() !== "active") return refuse("You can't remove anything right now.");
		const onMap = data.x >= 0 && data.z >= 0 && data.x < GRID_SIZE && data.z < GRID_SIZE;
		if (!onMap) return refuse("There's nothing to remove there.");
		const cell = cellIndex(data.x, data.z);
		const building = this.cells.get(cell);
		if (!building) {
			// No building: clear the trees and rocks on the cell instead.
			const center = cellCenter(cell);
			if (!this.inReach(player, center)) return refuse("That's too far away to clear.");
			const [low, high] = map.groundRange(cell, 1);
			if (this.clearProps(map, new Vector3(center.X, high, center.Z), CELL_STUDS, low) === 0) {
				refuse("There's nothing to remove there.");
			}
			return;
		}
		if (building.kind === "core") return refuse("The Core can't be removed.");
		if (!this.inReach(player, building.position)) return refuse("That's too far away to remove.");

		this.demolish(building);
		this.pay(BUILDINGS[building.kind].cost, REFUND);
	}

	/** Builds without any checks; `place` does those. */
	private build(map: PlanetMap, kind: BuildingKind, cell: number, rotation: number): Building {
		const def = BUILDINGS[kind];
		const [low, high] = map.groundRange(cell, def.size);
		const center = cellCenter(cell, def.size);
		const ore = kind === "drill" ? this.ores.get(cell) : undefined;
		const top = new Vector3(center.X, high + GROUND_CLEARANCE, center.Z);
		const [model, head] = buildingModel(kind, top, low - 2, rotation, ore && RESOURCES[ore.resource].color);
		const body = model.PrimaryPart!;
		model.SetAttribute("Kind", kind);
		model.SetAttribute("Cell", cell);
		if (ore) model.SetAttribute("Stored", 0);
		setHealth(model, def.health, def.health);
		this.clearProps(map, top, def.size * CELL_STUDS, low);
		model.Parent = this.buildingsFolder;

		const building: Building = {
			kind,
			model,
			cell,
			position: body.Position,
			rotation,
			health: def.health,
			resource: ore?.resource,
			stored: 0,
			head,
		};
		this.buildings.add(building);
		for (const covered of footprint(cell, def.size)) {
			this.cells.set(covered, building);
			const minePrompt = this.minePrompts.get(covered);
			if (minePrompt) minePrompt.Enabled = false;
		}
		this.revision++;

		if (kind === "core") {
			prompt(body, "Deposit", "Core", 0, 16).Triggered.Connect((player) => this.deposit(player));
		} else if (ore) {
			prompt(body, "Collect", "Drill", 0).Triggered.Connect((player) => this.collect(player, building));
		}
		return building;
	}

	private demolish(building: Building) {
		building.model.Destroy();
		this.buildings.delete(building);
		for (const covered of footprint(building.cell, BUILDINGS[building.kind].size)) {
			this.cells.delete(covered);
			const minePrompt = this.minePrompts.get(covered);
			if (minePrompt) minePrompt.Enabled = true;
		}
		if (building === this.core) this.core = undefined;
		this.revision++;
	}

	/**
	 * Destroys the trees and rocks touching a `width`-wide square from `low` up past `top`: under a new
	 * building, or cleared with the remove tool. Ore stays: it is the deposit itself. Returns how many went.
	 */
	private clearProps(map: PlanetMap, top: Vector3, width: number, low: number): number {
		const params = new OverlapParams();
		params.FilterType = Enum.RaycastFilterType.Include;
		params.FilterDescendantsInstances = [map.props];
		const height = top.Y - low + 42;
		const box = new CFrame(top.X, low - 2 + height / 2, top.Z);
		let cleared = 0;
		for (const part of Workspace.GetPartBoundsInBox(box, new Vector3(width - 0.5, height, width - 0.5), params)) {
			const model = part.FindFirstAncestorOfClass("Model");
			const prop = model && model.IsDescendantOf(map.props) ? model : part;
			// A model already destroyed through another of its parts is no longer under the props.
			if (!prop.IsDescendantOf(map.props) || CollectionService.HasTag(prop, "Ore")) continue;
			prop.Destroy();
			cleared++;
		}
		return cleared;
	}

	private mine(player: Player, resource: ResourceId) {
		if (this.give(player, resource, MINE_AMOUNT) < MINE_AMOUNT) this.notify(player, FULL);
	}

	private collect(player: Player, drill: Building) {
		if (!this.buildings.has(drill) || drill.resource === undefined) return;
		if (drill.stored === 0) return this.notify(player, "Nothing to collect yet.");
		drill.stored -= this.give(player, drill.resource, drill.stored);
		drill.model.SetAttribute("Stored", drill.stored);
		if (drill.stored > 0) this.notify(player, FULL);
	}

	private deposit(player: Player) {
		const items = this.inventories.get(player) ?? {};
		const stacks = new Array<ResourceStack>();
		for (const [resource, amount] of pairs(items)) stacks.push({ resource, amount });
		if (stacks.isEmpty()) return this.notify(player, "You have nothing to deposit.");
		this.pay(stacks, 1);
		this.setInventory(player, {});
	}

	private runDrills() {
		for (const building of this.buildings) {
			if (building.resource === undefined || building.stored >= DRILL_CAPACITY) continue;
			building.stored++;
			building.model.SetAttribute("Stored", building.stored);
		}
	}

	/** Whether a player is alive and close enough (across the ground) to build at `target`. */
	private inReach(player: Player, target: Vector3): boolean {
		const character = player.Character;
		const humanoid = character?.FindFirstChildOfClass("Humanoid");
		if (!character || !humanoid || humanoid.Health <= 0) return false;
		const position = character.GetPivot().Position;
		return new Vector2(position.X - target.X, position.Z - target.Z).Magnitude <= BUILD_RANGE;
	}

	private nearSpawn(cell: number): boolean {
		const [gx, gz] = cellCoords(cell);
		return this.spawnCells.some(([sx, sz]) => math.max(math.abs(gx - sx), math.abs(gz - sz)) <= SPAWN_CLEARANCE);
	}
}
