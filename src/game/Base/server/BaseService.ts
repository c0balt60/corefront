import { OnStart, Service } from "@flamework/core";
import { atom, computed } from "@rbxts/charm";
import { Cmdr } from "@rbxts/cmdr";
import type { Logger } from "@rbxts/log";
import { CollectionService, Players, StarterPack, Workspace } from "@rbxts/services";
import { t } from "@rbxts/t";

import {
	type BeltLook,
	beltModel,
	buildingModel,
	buildToolHandle,
	setAmmo,
	setFilter,
	setHealth,
} from "game/Base/server/models";
import { BaseMessage, baseMessaging, BeltMessage, beltMessaging, type Phase } from "game/Base/shared/base-network";
import { alongPath, type BeltPath, DIRECTIONS, entryOf, feedsBelt, runPaths } from "game/Base/shared/belts";
import {
	AMMO,
	BUILD_RANGE,
	BUILD_TOOL,
	type BuildableKind,
	BUILDABLE,
	BUILDINGS,
	type BuildingKind,
	MACHINE_SECONDS,
	MAX_LINE,
	MINE_SECONDS,
	REFUND,
	replaces,
	TRANSFER_RANGE,
} from "game/Base/shared/buildings";
import { KIND_ORES, RESOURCE_ORDER, RESOURCES, type ResourceId, type ResourceStack } from "game/Base/shared/resources";
import { PlanetsService } from "game/Planets/server/PlanetsService";
import { levelsOf, statOf, teamStat } from "game/Research/server/research-store";
import { canBuild } from "game/Research/shared/research";
import type { OreDeposit, PlanetMap } from "game/Terrain/server/planet-map";
import { CELL_STUDS, cellAt, cellCenter, cellCoords, cellIndex, GRID_SIZE } from "game/Terrain/shared/map";

/** Resource amounts by id. A missing key is zero. */
export type Stock = Partial<Record<ResourceId, number>>;

/** Ore on a belt, or held by a router. */
export interface Item {
	readonly resource: ResourceId;
	/** Belts: how far along, from 0 at the back of its path to 1 at the front. Routers: seconds held. */
	progress: number;
	/** Routers: the building it came from, which they never send it straight back to. */
	readonly from?: Building;
}

/** A building on the map. Its model carries the same facts as attributes, for the client. */
export interface Building {
	readonly kind: BuildingKind;
	/** Stays for the building's life: turning it or reshaping a belt remakes the parts inside. */
	readonly model: Model;
	/** The -X/-Z corner cell. */
	readonly cell: number;
	/** The body's centre: what range checks and shots use. */
	position: Vector3;
	/** Quarter turns, 0-3: the way it faces (see `DIRECTIONS`). A belt carries ore that way. */
	rotation: number;
	/** The UserId of the player who placed it, whose research its stats use. 0 for the Core. */
	readonly owner: number;
	health: number;
	/** Fixed when it's placed, from its placer's research. The Core's follows the team's. */
	maxHealth: number;
	/** Turrets: seconds until they can fire again. */
	cooldown: number;
	/** Drills and smelters: what they make. */
	readonly resource?: ResourceId;
	/** Drills and smelters: made and waiting to go out, to a neighbour or a player. */
	stored: number;
	/** Turrets: the part that turns to aim. */
	head?: BasePart;
	/** Belts: the side their path comes in from, and the path, as laid with the rest of their run (see `runPaths`). */
	entry: number;
	path?: BeltPath;
	/** Belts: the ore on them, back to front. Routers: the one they hold. */
	readonly items: Array<Item>;
	/** Turrets: the ore loaded, fired from the front, and how many shots the front one has given. */
	readonly ammo: Array<ResourceId>;
	fired: number;
	/** Smelters: how much of their input they hold. */
	input: number;
	/** Sorters: the ore they let straight through. Everything else turns aside. */
	filter?: ResourceId;
	/** Which neighbour it hands ore to next, so it takes turns. */
	turn: number;
	/** Belts: what their parts were last made for (see `beltLook`), so they're only remade when it changes. */
	look: string;
}

/** A liberated planet's base while the team is away: everything but the Core, which left with them. */
interface SavedBase {
	readonly buildings: ReadonlyArray<
		Pick<Building, "kind" | "cell" | "rotation" | "owner" | "health" | "stored" | "filter">
	>;
	/** What stayed in storage: whatever wasn't loaded as cargo or burnt as fuel. */
	readonly pool: Stock;
}

/** The pool of a fresh start, with nothing saved and no cargo coming. Enough to research and place the first walls and turrets. */
const START_POOL: Stock = { copper: 80, lead: 40 };
/** Seconds of network jitter a held mine click is allowed, so ordinary lag doesn't drop ore. */
const MINE_SLACK = 0.05;
/** Buildings keep this many cells clear of an alien spawn, so waves can't be walled in at the source. */
const SPAWN_CLEARANCE = 3;
/** Most height difference across a footprint, in studs. */
const MAX_SLOPE = 6;
/** How far a foundation's top stands above the highest ground under it, so it never shares a plane with the terrain. */
const GROUND_CLEARANCE = 0.5;
const FULL = "Your pack is full. Deposit at the Core.";
const OCCUPIED = "Something is already built there.";

const isPlaceData = t.interface({
	kind: (value: unknown): value is BuildableKind => BUILDABLE.includes(value as BuildableKind),
	cells: t.array(t.interface({ x: t.integer, z: t.integer, rotation: t.integer })),
});
const isCellData = t.interface({ x: t.integer, z: t.integer });
/** A cell, and an ore or none: a sorter's filter, or what to take off a belt. */
const isCellOreData = t.interface({ x: t.integer, z: t.integer, resource: t.optional(t.keyOf(RESOURCES)) });
const isDropData = t.interface({ resource: t.keyOf(RESOURCES) });

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

/**
 * The team's base on the active planet: the Core and its shared pool, every
 * player's carried inventory, buildings and their placement rules, what each
 * building takes in, and mining, collecting, loading and dropping by hand.
 * `WaveService` drives it: it calls {@link BaseService.reset} for each new
 * planet and attacks what is built here. `LogisticsService` moves ore between
 * the buildings.
 */
@Service()
export class BaseService implements OnStart {
	/** The Core's pool: this planet's resources, zeros included. Only this service writes it. */
	readonly poolAtom = atom<Stock>({});
	readonly coreHealthAtom = atom(0);
	readonly coreMaxHealthAtom = atom(0);
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
	/** When each player last mined, so a held click mines no faster than `MINE_SECONDS`. */
	private readonly lastMined = new Map<Player, number>();
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
		baseMessaging.server.on(BaseMessage.Rotate, (player, data) => this.rotate(player, data));
		beltMessaging.server.on(BeltMessage.Configure, (player, data) => this.configure(player, data));
		baseMessaging.server.on(BaseMessage.Mine, (player, data) => this.mine(player, data));
		baseMessaging.server.on(BaseMessage.Collect, (player, data) => {
			const building = this.reachable(player, data);
			if (building) this.collect(player, building, isCellOreData(data) ? data.resource : undefined);
		});
		baseMessaging.server.on(BaseMessage.Drop, (player, data) => this.drop(player, data));
		baseMessaging.server.on(BaseMessage.Load, (player, data) => {
			const building = this.reachable(player, data);
			if (building) this.load(player, building);
		});

		// Only tells the client to show the build bar.
		const tool = new Instance("Tool");
		tool.Name = BUILD_TOOL;
		tool.CanBeDropped = false;
		tool.ToolTip = "Build and remove";
		buildToolHandle(tool);
		tool.Parent = StarterPack;

		// What a player carries is lost when they die.
		const watch = (player: Player) =>
			player.CharacterAdded.Connect((character) => {
				const humanoid = character.WaitForChild("Humanoid") as Humanoid;
				humanoid.Died.Connect(() => this.setInventory(player, {}));
			});
		Players.GetPlayers().forEach(watch);
		Players.PlayerAdded.Connect(watch);
		Players.PlayerRemoving.Connect((player) => {
			this.inventories.delete(player);
			this.lastMined.delete(player);
		});

		task.spawn(() => {
			while (true) {
				task.wait(MACHINE_SECONDS);
				if (this.phase() === "active") this.runMachines();
			}
		});

		Cmdr.Registry.RegisterCommandsIn(script.Parent!.WaitForChild("commands"));
	}

	/**
	 * Clears the base and, given a map, starts one on it: a Core at the landing,
	 * plus the planet's saved base if it has one.
	 * The pool is what was saved plus any cargo landing here; with neither, the
	 * starting pool. Everyone's inventory is emptied either way.
	 */
	reset(map: PlanetMap | undefined) {
		for (const building of this.buildings) building.model.Destroy();
		this.buildings.clear();
		this.cells.clear();
		this.core = undefined;
		this.revision++;
		this.ores.clear();
		for (const player of Players.GetPlayers()) this.setInventory(player, {});
		this.resultAtom(undefined);

		this.map = map;
		if (!map) {
			this.spawnCells = [];
			this.poolAtom({});
			this.coreHealthAtom(0);
			this.coreMaxHealthAtom(0);
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

		for (const ore of map.ores) this.ores.set(ore.cell, ore);

		// The landing is a cell corner: the Core's 2×2 cells meet on it.
		const corner = cellAt(map.landing.X - CELL_STUDS / 2, map.landing.Z - CELL_STUDS / 2);
		if (corner !== undefined) this.core = this.build(map, "core", corner, 0, 0);
		this.coreHealthAtom(this.core?.health ?? 0);
		this.coreMaxHealthAtom(this.core?.maxHealth ?? 0);

		for (const old of saved?.buildings ?? []) {
			const building = this.build(map, old.kind, old.cell, old.rotation, old.owner);
			building.health = math.min(old.health, building.maxHealth);
			building.stored = old.stored;
			building.filter = old.filter;
			setHealth(building.model, building.health, building.maxHealth);
			if (building.resource !== undefined) building.model.SetAttribute("Stored", old.stored);
			if (old.filter !== undefined) setFilter(building.model, old.filter);
		}
	}

	/** Brings the Core's max health up to the team's research, healing it by the difference. */
	refreshCore() {
		const core = this.core;
		if (!core) return;
		const max = teamStat("coreHealth");
		core.health += max - core.maxHealth;
		core.maxHealth = max;
		setHealth(core.model, core.health, core.maxHealth);
		this.coreHealthAtom(core.health);
		this.coreMaxHealthAtom(max);
	}

	/** Keeps the active planet's base, all but the Core, for when the team comes back to `planet`. */
	save(planet: number) {
		const buildings = new Array<SavedBase["buildings"][number]>();
		for (const { kind, cell, rotation, owner, health, stored, filter } of this.buildings) {
			if (kind !== "core") buildings.push({ kind, cell, rotation, owner, health, stored, filter });
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
		setHealth(building.model, building.health, building.maxHealth);
		if (building === this.core) this.coreHealthAtom(building.health);
		if (building.health > 0) return;

		this.demolish(building);
		if (building.kind === "core") this.end("lost");
	}

	/** Heals a building, up to its max health. */
	repair(building: Building, amount: number) {
		if (!this.buildings.has(building) || building.health >= building.maxHealth) return;
		building.health = math.min(building.health + amount, building.maxHealth);
		setHealth(building.model, building.health, building.maxHealth);
		if (building === this.core) this.coreHealthAtom(building.health);
	}

	/** Adds to (or, negative, takes from) the pool. False if this planet has no such resource. */
	addToPool(resource: ResourceId, amount: number): boolean {
		if (this.poolAtom()[resource] === undefined) return false;
		this.pay([{ resource, amount }], 1);
		return true;
	}

	/**
	 * Takes one `resource` into a building that keeps or uses ore: the Core's pool (up to its capacity),
	 * a turret's ammo or a smelter's input. False when it won't take it; carriers are `LogisticsService`'s.
	 */
	receive(building: Building, resource: ResourceId): boolean {
		const def = BUILDINGS[building.kind];
		if (building === this.core) {
			if ((this.poolAtom()[resource] ?? 0) >= teamStat("coreCapacity")) return false;
			this.pay([{ resource, amount: 1 }], 1);
		} else if (def.turret) {
			if (AMMO[resource] === undefined || building.ammo.size() >= def.turret.magazine) return false;
			building.ammo.push(resource);
			setAmmo(building.model, building.ammo.size());
		} else if (def.craft) {
			if (resource !== def.craft.input || building.input >= def.craft.storage) return false;
			building.input++;
			building.model.SetAttribute("Input", building.input);
		} else {
			return false;
		}
		return true;
	}

	/** Spends one of a turret's shots. Returns how hard it hits, times the turret's damage, or undefined with no ammo. */
	shoot(turret: Building): number | undefined {
		const def = BUILDINGS[turret.kind].turret;
		const resource = turret.ammo[0];
		if (!def || resource === undefined) return undefined;
		turret.fired++;
		if (turret.fired >= def.shots) {
			turret.ammo.shift();
			turret.fired = 0;
			setAmmo(turret.model, turret.ammo.size());
		}
		return AMMO[resource];
	}

	/** The building on the cell next to `cell` toward `side` (see `DIRECTIONS`), if any. */
	neighbour(cell: number, side: number): Building | undefined {
		const [gx, gz] = cellCoords(cell);
		const [dx, dz] = DIRECTIONS[side];
		return this.buildingOn(gx + dx, gz + dz);
	}

	/** Every building touching `building`, and the side of it each is on: one entry per cell they touch along. */
	around(building: Building): Array<[neighbour: Building, side: number]> {
		const touching = new Array<[Building, number]>();
		for (const covered of footprint(building.cell, BUILDINGS[building.kind].size)) {
			for (let side = 0; side < 4; side++) {
				const other = this.neighbour(covered, side);
				if (other && other !== building) touching.push([other, side]);
			}
		}
		return touching;
	}

	/** Puts up to `amount` into a player's inventory, within its capacity. Returns how many fit. */
	give(player: Player, resource: ResourceId, amount: number): number {
		const items = this.inventories.get(player) ?? {};
		let carried = 0;
		for (const [, count] of pairs(items)) carried += count;
		const given = math.max(0, math.min(amount, statOf(player.UserId, "carryCapacity") - carried));
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
			capacity: statOf(player.UserId, "carryCapacity"),
		});
	}

	notify(player: Player, text: string) {
		baseMessaging.client.emit(player, BaseMessage.Notice, { text });
	}

	private setInventory(player: Player, items: Stock) {
		this.inventories.set(player, items);
		this.sendInventory(player);
	}

	/**
	 * Adds each stack, scaled, to the pool: -1 spends a cost, `REFUND` gives part of it back.
	 * What's added stops at the Core's capacity; a pool already over it (landed cargo) keeps the excess.
	 */
	private pay(stacks: ReadonlyArray<ResourceStack>, scale: number) {
		const pool = { ...this.poolAtom() };
		const capacity = teamStat("coreCapacity");
		for (const { resource, amount } of stacks) {
			const current = pool[resource] ?? 0;
			const added = current + math.floor(amount * scale);
			pool[resource] = added > current ? math.max(current, math.min(added, capacity)) : added;
		}
		this.poolAtom(pool);
	}

	/**
	 * Builds each cell of a click or dragged line in turn. A line skips what's built already, except
	 * that a belt line crossing a straight belt swaps it for a Junction, so both lines flow on; where
	 * it can't, the line stops there and feeds into it. Any other refusal is told once.
	 */
	private place(player: Player, data: unknown) {
		if (!isPlaceData(data) || data.cells.isEmpty() || data.cells.size() > MAX_LINE) return;
		const refuse = (text: string) => this.notify(player, text);
		const map = this.map;
		const def = BUILDINGS[data.kind];
		if (!map || this.phase() !== "active") return refuse("You can't build right now.");
		if (!canBuild(levelsOf(player.UserId), data.kind)) return refuse(`Research the ${def.name} first.`);

		// A belt line keeps the routers and such it runs through; anything else, or one belt, swaps them out.
		const swap = data.kind !== "conveyor" || data.cells.size() === 1;
		let refusal: string | undefined;
		for (let index = 0; index < data.cells.size(); index++) {
			const { x, z, rotation } = data.cells[index];
			// Crossing happens on the way through, not where a line starts or ends.
			const through = data.kind === "conveyor" && index > 0 && index < data.cells.size() - 1;
			const crossed = through ? this.crossable(x, z, rotation % 4) : undefined;
			const reason = crossed
				? this.cross(player, map, crossed)
				: this.placeOne(player, map, data.kind, x, z, rotation % 4, swap);
			if (reason !== OCCUPIED || data.cells.size() === 1) refusal ??= reason;
			if (crossed && reason !== undefined) break;
		}
		if (refusal !== undefined) refuse(refusal);
	}

	/** The straight belt on cell (x, z) running across a line heading `rotation`, which a Junction can stand in for. */
	private crossable(x: number, z: number, rotation: number): Building | undefined {
		const belt = this.buildingOn(x, z);
		if (belt?.kind !== "conveyor" || belt.rotation % 2 === rotation % 2) return undefined;
		return belt.entry === (belt.rotation + 2) % 4 ? belt : undefined;
	}

	/** Swaps a belt a line crosses for a Junction, the belt refunded like a removal. Returns why not, if it can't. */
	private cross(player: Player, map: PlanetMap, belt: Building): string | undefined {
		if (!canBuild(levelsOf(player.UserId), "junction")) return "Research the Junction to cross belts.";
		if (!this.inReach(player, belt.position)) return "That's too far away to build.";
		const short = this.shortOf(BUILDINGS.junction.cost);
		if (short !== undefined) return short;

		this.demolish(belt);
		this.pay(BUILDINGS.conveyor.cost, REFUND);
		this.pay(BUILDINGS.junction.cost, -1);
		this.build(map, "junction", belt.cell, 0, player.UserId);
		return undefined;
	}

	/** Why the pool can't pay `cost`, if it can't. */
	private shortOf(cost: ReadonlyArray<ResourceStack>): string | undefined {
		const pool = this.poolAtom();
		const missing = cost.find(({ resource, amount }) => (pool[resource] ?? 0) < amount);
		return missing && `Not enough ${RESOURCES[missing.resource].name}.`;
	}

	/**
	 * Builds `kind` with its -X/-Z corner on cell (x, z), paid from the pool. With `swap`, a belt piece
	 * of another kind there is replaced (see `replaces`). Returns why not, if it can't.
	 */
	private placeOne(
		player: Player,
		map: PlanetMap,
		kind: BuildableKind,
		x: number,
		z: number,
		rotation: number,
		swap: boolean,
	): string | undefined {
		const def = BUILDINGS[kind];
		if (x < 0 || z < 0 || x + def.size > GRID_SIZE || z + def.size > GRID_SIZE) return "That's off the map.";
		const cell = cellIndex(x, z);
		if (!this.inReach(player, cellCenter(cell, def.size))) return "That's too far away to build.";
		const cells = footprint(cell, def.size);
		const there = this.cells.get(cell);
		const replaced = swap && there && replaces(kind, there.kind) ? there : undefined;
		if (cells.some((covered) => this.cells.has(covered) && this.cells.get(covered) !== replaced)) return OCCUPIED;
		if (cells.some((covered) => this.nearSpawn(covered))) return "Too close to an alien spawn.";
		if (cells.some((covered) => map.isLiquid(cellCenter(covered).X, cellCenter(covered).Z))) {
			return "You can't build on liquid.";
		}
		// Belts go anywhere: they keep their grade and stand on their supports (see `runPaths`).
		const [low, high] = map.groundRange(cell, def.size);
		if (kind !== "conveyor" && high - low > MAX_SLOPE) return "The ground is too steep there.";
		if (def.drill && !this.ores.has(cell)) return "Drills must go on ore.";
		const short = this.shortOf(def.cost);
		if (short !== undefined) return short;

		if (replaced) {
			this.demolish(replaced);
			this.pay(BUILDINGS[replaced.kind].cost, REFUND);
		}
		this.pay(def.cost, -1);
		this.build(map, kind, cell, rotation, player.UserId);
		return undefined;
	}

	/** Turns a building a quarter turn, free. A belt then carries the new way. */
	private rotate(player: Player, data: unknown) {
		if (!isCellData(data)) return;
		const map = this.map;
		if (!map || this.phase() !== "active") return this.notify(player, "You can't turn anything right now.");
		const building = this.buildingOn(data.x, data.z);
		if (!building || building.kind === "core") return;
		if (!this.inReach(player, building.position)) return this.notify(player, "That's too far away to turn.");

		building.rotation = (building.rotation + 1) % 4;
		// A belt is remade with its neighbours, which its new way can change.
		if (building.kind !== "conveyor") this.dress(map, building);
		this.refreshAround(map, building);
	}

	/** Sets the ore a Sorter lets straight through, or none. */
	private configure(player: Player, data: unknown) {
		if (!isCellOreData(data) || this.phase() !== "active") return;
		const sorter = this.buildingOn(data.x, data.z);
		if (sorter?.kind !== "sorter") return;
		if (!this.inReach(player, sorter.position)) return this.notify(player, "That's too far away to set.");
		sorter.filter = data.resource;
		setFilter(sorter.model, data.resource);
	}

	private remove(player: Player, data: unknown) {
		if (!isCellData(data)) return;
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
	private build(map: PlanetMap, kind: BuildingKind, cell: number, rotation: number, owner: number): Building {
		const def = BUILDINGS[kind];
		const maxHealth =
			kind === "core" ? teamStat("coreHealth") : math.round(def.health * statOf(owner, "buildingHealth"));
		const model = new Instance("Model");
		model.SetAttribute("Kind", kind);
		model.SetAttribute("Cell", cell);
		const building: Building = {
			kind,
			model,
			cell,
			position: cellCenter(cell, def.size),
			rotation,
			owner,
			health: maxHealth,
			maxHealth,
			cooldown: 0,
			resource: def.drill ? this.ores.get(cell)?.resource : def.craft?.output,
			stored: 0,
			entry: (rotation + 2) % 4,
			items: [],
			ammo: [],
			fired: 0,
			input: 0,
			turn: 0,
			look: "",
		};
		if (building.resource !== undefined) {
			model.SetAttribute("Resource", building.resource);
			model.SetAttribute("Stored", 0);
		}
		if (def.drill) model.SetAttribute("Yield", def.drill.yield + statOf(owner, "drillYield"));
		if (def.craft) model.SetAttribute("Input", 0);
		this.buildings.add(building);
		for (const covered of footprint(cell, def.size)) this.cells.set(covered, building);
		this.revision++;

		const [low, high] = map.groundRange(cell, def.size);
		const center = cellCenter(cell, def.size);
		this.clearProps(map, new Vector3(center.X, high + GROUND_CLEARANCE, center.Z), def.size * CELL_STUDS, low);
		// A belt is made with its run, once it's in (see `reshape`).
		if (kind === "conveyor") building.entry = this.beltEntry(building);
		else this.dress(map, building);
		model.Parent = this.buildingsFolder;
		this.refreshAround(map, building);
		return building;
	}

	/**
	 * (Re)makes a building's parts inside its model, for its kind, facing and (belts) shape.
	 * The Model itself stays, and so do its attributes and the client's hold on it.
	 */
	private dress(map: PlanetMap, building: Building) {
		const { kind, model } = building;
		const def = BUILDINGS[kind];
		model.ClearAllChildren();
		const [low, high] = map.groundRange(building.cell, def.size);
		let body: BasePart;
		if (kind === "conveyor") {
			const path = building.path!;
			const [look, key] = this.beltLook(building);
			building.look = key;
			body = beltModel(model, path, map.heightAt, look);
			model.SetAttribute("Entry", building.entry);
			model.SetAttribute("PathIn", path[0]);
			model.SetAttribute("PathMid", path[1]);
			model.SetAttribute("PathOut", path[2]);
			model.SetAttribute("PathEnds", path[3]);
		} else {
			const center = cellCenter(building.cell, def.size);
			const top = new Vector3(center.X, high + GROUND_CLEARANCE, center.Z);
			const color = building.resource !== undefined ? RESOURCES[building.resource].color : undefined;
			const [made, head] = buildingModel(model, kind, top, low - 2, building.rotation, color);
			body = made;
			building.head = head;
		}
		model.SetAttribute("Rotation", building.rotation);
		building.position = body.Position;
		setHealth(model, building.health, building.maxHealth);
		if (def.turret) setAmmo(model, building.ammo.size());
		if (kind === "sorter") setFilter(model, building.filter);
	}

	/** Whether the building beside a belt on `side` puts ore onto it. Never what's in front of it. */
	private fedFrom(belt: Building, side: number): boolean {
		const other = this.neighbour(belt.cell, side);
		return side !== belt.rotation && other !== undefined && feedsBelt(other.kind, other.rotation, side);
	}

	/** The side a belt's path comes in from (see `entryOf`): a corner when one side alone feeds it. */
	private beltEntry(belt: Building): number {
		return entryOf(belt.rotation, (side) => this.fedFrom(belt, side));
	}

	/** The belt this one feeds from the side, if it does: that one takes its ore in by the side facing back at it. */
	private mergeInto(belt: Building): Building | undefined {
		const back = (belt.rotation + 2) % 4;
		const ahead = this.neighbour(belt.cell, belt.rotation);
		return ahead?.kind === "conveyor" && ahead.rotation !== back && ahead.entry !== back ? ahead : undefined;
	}

	/**
	 * How a belt meets what's around it, and a key that changes whenever that or its path does.
	 * Rails open on the sides feeding a straight belt, and its back closes when nothing feeds it
	 * there. Feeding the side of the belt ahead, it reaches on into it.
	 */
	private beltLook(belt: Building): [look: BeltLook, key: string] {
		const back = (belt.rotation + 2) % 4;
		const straight = belt.entry === back;
		const look: BeltLook = {
			rails: [
				!straight || !this.fedFrom(belt, (belt.rotation + 1) % 4),
				!straight || !this.fedFrom(belt, (belt.rotation + 3) % 4),
			],
			capped: straight && !this.fedFrom(belt, back),
			tail: this.mergeInto(belt) !== undefined,
		};
		const [from, middle, to, ends] = belt.path!;
		return [look, `${look.rails[0]}/${look.rails[1]}/${look.capped}/${look.tail}/${from}/${middle}/${to}/${ends}`];
	}

	/** The belts a belt is in a run with (see `runPaths`): each passing its ore to the next by that one's entry. */
	private runOf(belt: Building): Array<Building> {
		// The belt before one faces into it from its entry; the one after takes its ore in by its entry.
		const before = (other: Building) => {
			const prior = this.neighbour(other.cell, other.entry);
			return prior?.kind === "conveyor" && prior.rotation === (other.entry + 2) % 4 ? prior : undefined;
		};
		const after = (other: Building) => {
			const onward = this.neighbour(other.cell, other.rotation);
			return onward?.kind === "conveyor" && onward.entry === (other.rotation + 2) % 4 ? onward : undefined;
		};
		// Back to the first, or round to where it started on a loop.
		let first = belt;
		for (let prior = before(first); prior && prior !== belt; prior = before(first)) first = prior;
		const run = [first];
		for (let onward = after(first); onward && onward !== first; onward = after(onward)) run.push(onward);
		return run;
	}

	/**
	 * Lays out again the runs `belts` are in, and remakes those of their belts whose look that
	 * changed; then the runs feeding those from the side, which meet them at their height.
	 */
	private reshape(map: PlanetMap, belts: ReadonlySet<Building>) {
		const queue = new Array<Building>();
		for (const belt of belts) queue.push(belt);
		const done = new Set<Building>();
		// ponytail: belts feeding each other's sides in a ring could keep moving each other; stop after this many runs.
		let budget = 256;
		while (!queue.isEmpty() && budget > 0) {
			const belt = queue.pop()!;
			if (done.has(belt) || !this.buildings.has(belt)) continue;
			budget--;
			const run = this.runOf(belt);
			const receiver = this.mergeInto(run[run.size() - 1]);
			const merge = receiver?.path && alongPath(receiver.path, 0.5)[0].Y;
			const paths = runPaths(run, map.heightAt, merge);
			run.forEach((member, index) => {
				done.add(member);
				member.path = paths[index];
				if (this.beltLook(member)[1] === member.look) return;
				this.dress(map, member);
				for (const side of [(member.rotation + 1) % 4, (member.rotation + 3) % 4]) {
					const feeder = this.neighbour(member.cell, side);
					if (side === member.entry || feeder?.kind !== "conveyor" || feeder.rotation !== (side + 2) % 4)
						continue;
					done.delete(feeder);
					queue.push(feeder);
				}
			});
		}
	}

	/**
	 * Remakes the belts near `building`, just built, turned or removed, whose look that changed:
	 * those beside it may have gained or lost a feeder. Their runs are laid out again whole, as a
	 * belt anywhere in one can raise the rest.
	 */
	private refreshAround(map: PlanetMap, building: Building) {
		const [gx, gz] = cellCoords(building.cell);
		const size = BUILDINGS[building.kind].size;
		const near = new Set<Building>();
		for (let z = gz - 2; z < gz + size + 2; z++) {
			for (let x = gx - 2; x < gx + size + 2; x++) {
				const belt = this.buildingOn(x, z);
				if (belt?.kind === "conveyor") near.add(belt);
			}
		}
		// Every shape first: which belts make a run depends on them.
		for (const belt of near) belt.entry = this.beltEntry(belt);
		this.reshape(map, near);
	}

	/** The building covering cell (x, z), if any. */
	private buildingOn(x: number, z: number): Building | undefined {
		if (x < 0 || z < 0 || x >= GRID_SIZE || z >= GRID_SIZE) return undefined;
		return this.cells.get(cellIndex(x, z));
	}

	private demolish(building: Building) {
		building.model.Destroy();
		this.buildings.delete(building);
		for (const covered of footprint(building.cell, BUILDINGS[building.kind].size)) this.cells.delete(covered);
		if (building === this.core) this.core = undefined;
		this.revision++;
		if (this.map) this.refreshAround(this.map, building);
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

	/** Mines one ore from the deposit on a cell, for a held click: in reach, not built over, and no faster than `MINE_SECONDS`. */
	private mine(player: Player, data: unknown) {
		if (!isCellData(data) || this.phase() !== "active") return;
		if (data.x < 0 || data.z < 0 || data.x >= GRID_SIZE || data.z >= GRID_SIZE) return;
		const cell = cellIndex(data.x, data.z);
		const ore = this.ores.get(cell);
		if (!ore || this.cells.has(cell) || !this.inReach(player, cellCenter(cell), TRANSFER_RANGE)) return;
		const now = os.clock();
		if (now - (this.lastMined.get(player) ?? -math.huge) < MINE_SECONDS - MINE_SLACK) return;
		this.lastMined.set(player, now);
		if (this.give(player, ore.resource, 1) === 0) this.notify(player, FULL);
	}

	/** The building covering a cell a player wants to move items in or out of, if they're close enough to. */
	private reachable(player: Player, data: unknown): Building | undefined {
		if (!isCellData(data) || this.phase() !== "active") return undefined;
		const building = this.buildingOn(data.x, data.z);
		if (building && !this.inReach(player, building.position, TRANSFER_RANGE)) {
			this.notify(player, "That's too far away. Move closer.");
			return undefined;
		}
		return building;
	}

	/** Moves what a drill or smelter has made, or the ore on a belt (just `only`, if given), into a player's pack, as much as fits. */
	private collect(player: Player, building: Building, only?: ResourceId) {
		if (!this.buildings.has(building)) return;
		if (building.kind === "conveyor") return this.takeOff(player, building, only);
		if (building.resource === undefined) return;
		if (building.stored === 0) return this.notify(player, "Nothing to collect yet.");
		building.stored -= this.give(player, building.resource, building.stored);
		building.model.SetAttribute("Stored", building.stored);
		if (building.stored > 0) this.notify(player, FULL);
	}

	/** Moves the ore on a belt, or just the `only` ore, into a player's pack, front first, as much as fits. Clients redraw what's left. */
	private takeOff(player: Player, belt: Building, only?: ResourceId) {
		const counts = new Map<ResourceId, number>();
		for (const { resource } of belt.items) {
			if (only === undefined || resource === only) counts.set(resource, (counts.get(resource) ?? 0) + 1);
		}
		if (counts.isEmpty()) return this.notify(player, "There's nothing on it to take.");
		let full = false;
		for (const [resource, count] of counts) {
			let given = this.give(player, resource, count);
			full ||= given < count;
			for (let i = belt.items.size() - 1; i >= 0 && given > 0; i--) {
				if (belt.items[i].resource !== resource) continue;
				belt.items.remove(i);
				given--;
			}
		}
		const items = belt.items.map(({ resource, progress }) => ({ cell: belt.cell, resource, progress }));
		beltMessaging.client.emitAll(BeltMessage.Left, { cell: belt.cell, items });
		if (full) this.notify(player, FULL);
	}

	/** Throws away all of one resource a player carries. */
	private drop(player: Player, data: unknown) {
		if (!isDropData(data)) return;
		const items = { ...(this.inventories.get(player) ?? {}) };
		if (items[data.resource] === undefined) return;
		delete items[data.resource];
		this.setInventory(player, items);
	}

	/**
	 * Moves what a player carries into a building, as much as it takes: everything into the Core
	 * (see `deposit`), ammo into a turret, its input into a smelter. The rest stays carried.
	 */
	private load(player: Player, building: Building) {
		if (!this.buildings.has(building)) return;
		if (building === this.core) return this.deposit(player);
		const def = BUILDINGS[building.kind];
		if (!def.turret && !def.craft) return;
		const left: Stock = {};
		let loaded = 0;
		for (const [resource, amount] of pairs(this.inventories.get(player) ?? {})) {
			let kept = amount;
			while (kept > 0 && this.receive(building, resource)) kept--;
			loaded += amount - kept;
			if (kept > 0) left[resource] = kept;
		}
		if (loaded > 0) return this.setInventory(player, left);
		const full = def.craft
			? building.input >= def.craft.storage
			: building.ammo.size() >= (def.turret?.magazine ?? 0);
		const need = def.craft
			? `Carry ${RESOURCES[def.craft.input].name} to load it.`
			: "Carry ore to load it. Coal won't fire.";
		this.notify(player, full ? "It's fully loaded." : need);
	}

	/** Moves a player's inventory into the pool, as much as the Core has room for. The rest stays carried. */
	private deposit(player: Player) {
		const items = this.inventories.get(player) ?? {};
		const pool = this.poolAtom();
		const capacity = teamStat("coreCapacity");
		const stacks = new Array<ResourceStack>();
		const left: Stock = {};
		let carried = 0;
		let kept = 0;
		for (const [resource, amount] of pairs(items)) {
			const moved = math.clamp(capacity - (pool[resource] ?? 0), 0, amount);
			if (moved > 0) stacks.push({ resource, amount: moved });
			if (amount > moved) left[resource] = amount - moved;
			carried += amount;
			kept += amount - moved;
		}
		if (carried === 0) return this.notify(player, "You have nothing to deposit.");
		this.pay(stacks, 1);
		this.setInventory(player, left);
		if (kept > 0) this.notify(player, "The Core is full. Research Core Silos for more room.");
	}

	/** Drills mine, smelters smelt, and menders repair every damaged building in their range. */
	private runMachines() {
		for (const building of this.buildings) {
			const def = BUILDINGS[building.kind];
			if (def.drill && building.resource !== undefined) {
				// Follows its owner's research as it comes in.
				const mined = def.drill.yield + statOf(building.owner, "drillYield");
				building.model.SetAttribute("Yield", mined);
				if (building.stored < def.drill.storage) {
					building.stored = math.min(building.stored + mined, def.drill.storage);
					building.model.SetAttribute("Stored", building.stored);
				}
			}
			if (def.craft && building.input >= def.craft.amount && building.stored < def.craft.storage) {
				building.input -= def.craft.amount;
				building.model.SetAttribute("Input", building.input);
				building.stored++;
				building.model.SetAttribute("Stored", building.stored);
			}
			if (def.repair !== undefined && def.range !== undefined) {
				for (const other of this.buildings) {
					if (other.position.sub(building.position).Magnitude <= def.range) this.repair(other, def.repair);
				}
			}
		}
	}

	/** Whether a player is alive and within `range` of `target`, across the ground: to build there, by default. */
	private inReach(player: Player, target: Vector3, range = BUILD_RANGE): boolean {
		const character = player.Character;
		const humanoid = character?.FindFirstChildOfClass("Humanoid");
		if (!character || !humanoid || humanoid.Health <= 0) return false;
		const position = character.GetPivot().Position;
		return new Vector2(position.X - target.X, position.Z - target.Z).Magnitude <= range;
	}

	private nearSpawn(cell: number): boolean {
		const [gx, gz] = cellCoords(cell);
		return this.spawnCells.some(([sx, sz]) => math.max(math.abs(gx - sx), math.abs(gz - sz)) <= SPAWN_CLEARANCE);
	}
}
