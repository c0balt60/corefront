import { OnStart, Service } from "@flamework/core";
import { atom, computed, subscribe } from "@rbxts/charm";
import { Cmdr } from "@rbxts/cmdr";
import type { Logger } from "@rbxts/log";
import { CollectionService, Players, StarterPack, Workspace } from "@rbxts/services";
import { t } from "@rbxts/t";

import {
	type BeltLook,
	beltModel,
	buildingModel,
	buildToolHandle,
	linkLines,
	setAmmo,
	setFilter,
	setHealth,
	setPower,
} from "game/Base/server/models";
import { BaseMessage, baseMessaging, BeltMessage, beltMessaging, type Phase } from "game/Base/shared/base-network";
import { alongPath, type BeltPath, DIRECTIONS, entryOf, feedsBelt, runPaths } from "game/Base/shared/belts";
import {
	BUILD_RANGE,
	BUILD_TOOL,
	type BuildableKind,
	BUILDABLE,
	type BuildingDef,
	BUILDINGS,
	type BuildingKind,
	coreCorner,
	type CoreKind,
	coreStats,
	type EnergyDef,
	inDropZone,
	isBelt,
	isCore,
	isPowered,
	linkReach,
	MACHINE_SECONDS,
	MAX_LINE,
	REFUND,
	replaces,
	TRANSFER_RANGE,
} from "game/Base/shared/buildings";
import { KIND_ORES, RESOURCE_ORDER, RESOURCES, type ResourceId, type ResourceStack } from "game/Base/shared/resources";
import { PlanetsService } from "game/Planets/server/PlanetsService";
import { levelsOf, statOf } from "game/Research/server/research-store";
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
	/** Turrets: seconds until they can fire again, and the shots fired so far in their burst (see `BuildingDef`). */
	cooldown: number;
	burst: number;
	/** Turrets that spin up: how far, 0 to 1, and whether they had a target when they last looked. */
	spin: number;
	/** Beam lasers: seconds left on their beam (see `TurretDef.beam`). */
	burning: number;
	engaged: boolean;
	/**
	 * Turrets: which way their head points, (yaw, pitch) in radians (see `aimFrame`), the alien it
	 * tracks, if any, and seconds till it looks again for a better one.
	 */
	aim: [yaw: number, pitch: number];
	target?: Model;
	retarget: number;
	/** Drills and crafters: what they make. */
	readonly resource?: ResourceId;
	/** Drills and crafters: made and waiting to go out, to a neighbour or a player. */
	stored: number;
	/** Turrets: the part that turns to aim, and their barrels' tips relative to it, looking out of them. */
	head?: BasePart;
	muzzles: ReadonlyArray<CFrame>;
	/** Belts: the side their path comes in from, and the path, as laid with the rest of their run (see `runPaths`). */
	entry: number;
	path?: BeltPath;
	/** Belts: the ore on them, back to front. Routers: the one they hold. */
	readonly items: Array<Item>;
	/**
	 * Turrets: the shots loaded of each ore, the one loaded last at the back, which fires first, and
	 * all of them together. And the shots fired, so each comes from the next barrel round.
	 */
	readonly ammo: Array<{ readonly resource: ResourceId; amount: number }>;
	totalAmmo: number;
	fired: number;
	/** Crafters: how much of each input they hold. Generators: their fuel. Storage: everything in it. */
	readonly input: Stock;
	/** Sorters: the ore they let straight through. Everything else turns aside. Sources: the ore they hand out. */
	filter?: ResourceId;
	/** Which neighbour it hands ore to next, so it takes turns. */
	turn: number;
	/** Belts: what their parts were last made for (see `beltLook`), so they're only remade when it changes. */
	look: string;
	/** What it's linked to on the power network: a node's links, or the nodes linked to anything else (see `powerNetwork`). */
	readonly links: Set<Building>;
	/** What uses power: the share of its need its network last gave it, 0 to 1 (see `PowerService`). */
	power: number;
	/** Batteries: the power they hold. */
	charge: number;
	/** Generators that burn fuel: seconds left of the item burning, and that fuel's efficiency. */
	burn: number;
	efficiency: number;
	/** Drills and crafters: how far to their next go, 0 to 1. Each machine tick adds their share of power (see `runMachines`). */
	work: number;
}

/** Every building on `start`'s power network: what it links to, what those link to, and so on. */
export function powerNetwork(start: Building): Set<Building> {
	const network = new Set<Building>([start]);
	const queue = [start];
	while (!queue.isEmpty()) {
		for (const other of queue.pop()!.links) {
			if (network.has(other)) continue;
			network.add(other);
			queue.push(other);
		}
	}
	return network;
}

/** Whether a building takes `resource` in to keep, burn or make something with (see `Building.input`). */
function holds(def: BuildingDef, resource: ResourceId): boolean {
	return (
		def.store !== undefined ||
		def.generator?.fuel?.[resource] !== undefined ||
		def.craft?.inputs.some((stack) => stack.resource === resource) === true
	);
}

/** A liberated planet's base while the team is away: everything but the Core, which left with them. JSON-safe, so saves keep it. */
export interface SavedBase {
	readonly buildings: ReadonlyArray<
		Pick<Building, "kind" | "cell" | "rotation" | "owner" | "health" | "stored" | "filter" | "input"> & {
			/** The cells of what it's power-linked to. */
			readonly linked: ReadonlyArray<number>;
		}
	>;
	/** What stayed in storage: whatever wasn't loaded as cargo or burnt as fuel. */
	readonly pool: Stock;
}

/** The pool of a fresh start, with nothing saved and no cargo coming. Enough to research and place the first walls and turrets. */
const START_POOL: Stock = { copper: 80, lead: 40 };
/** Seconds of network jitter a held mine click is allowed, so ordinary lag doesn't drop ore. */
const MINE_SLACK = 0.05;
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
const isLinkData = t.interface({ x: t.integer, z: t.integer, toX: t.integer, toZ: t.integer });
/** What's lit in the ore picked for it: a Sorter's, a Source's or an Unloader's `filter`. */
const FILTERED: ReadonlySet<BuildingKind> = new Set(["sorter", "source", "unloader"]);

function makeFolder(name: string, parent: Instance): Folder {
	const instance = new Instance("Folder");
	instance.Name = name;
	instance.Parent = parent;
	return instance;
}

function makeModel(name: string, parent: Instance): Model {
	const instance = new Instance("Model");
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
 * the buildings, and `PowerService` power along the links nodes make here.
 */
@Service()
export class BaseService implements OnStart {
	/** The Core's pool: this planet's resources, zeros included. Only this service writes it. */
	readonly poolAtom = atom<Stock>({});
	readonly coreHealthAtom = atom(0);
	readonly coreMaxHealthAtom = atom(0);
	/**
	 * The Core's tier: the one standing, or the one to land next. It travels with the team, so it lands
	 * wherever they launch to; losing a planet loses it, back to a Shard. It sets everyone's stats (see `CoreDef`).
	 */
	readonly coreAtom = atom<CoreKind>("core");
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
	/** A Model, not a Folder, so one Highlight can show every alien in it (see `PingController`). */
	readonly aliensFolder = makeModel("Aliens", this.folder);
	/** Dead aliens, out of the fight, while clients blow them up and sink them (see `DamageController`). */
	readonly wrecksFolder = makeFolder("Wrecks", this.folder);

	readonly buildings = new Set<Building>();
	/** The building covering each cell. */
	readonly cells = new Map<number, Building>();
	/** Bumps whenever a building appears or goes, so the flowfield knows to rebuild. */
	revision = 0;
	core?: Building;
	/**
	 * A sandbox server, for testing against aliens: the pool holds every resource and never runs
	 * down, and the Core can't fall. `WaveService` sends no waves. Stays on for the server's life.
	 */
	readonly sandbox = atom(false);

	private map?: PlanetMap;
	private readonly ores = new Map<number, OreDeposit>();
	/** When each player last mined, so a held click mines no faster than the Core allows. */
	private readonly lastMined = new Map<Player, number>();
	private readonly inventories = new Map<Player, Stock>();
	/** Liberated planets' bases, while the team is elsewhere. */
	private readonly saved = new Map<number, SavedBase>();
	/** The cargo on its way, and where to. */
	private arrival?: { readonly planet: number; readonly cargo: Stock };
	/** The belts and walls this frame's builds, turns and removals touched, remade together once it's done (see `refreshAround`). */
	private pending?: { readonly belts: Set<Building>; readonly walls: Set<Building> };

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
		baseMessaging.server.on(BaseMessage.Link, (player, data) => this.toggleLink(player, data));

		// Only tells the client to show the build bar.
		const tool = new Instance("Tool");
		tool.Name = BUILD_TOOL;
		tool.CanBeDropped = false;
		tool.ToolTip = "Build and remove";
		buildToolHandle(tool);
		tool.Parent = StarterPack;

		// What a player carries is lost when they die. Their health is the Core's.
		const watch = (player: Player) =>
			player.CharacterAdded.Connect((character) => {
				const humanoid = character.WaitForChild("Humanoid") as Humanoid;
				humanoid.MaxHealth = humanoid.Health = this.stats().health;
				humanoid.Died.Connect(() => this.setInventory(player, {}));
			});
		Players.GetPlayers().forEach(watch);
		Players.PlayerAdded.Connect(watch);
		Players.PlayerRemoving.Connect((player) => {
			this.inventories.delete(player);
			this.lastMined.delete(player);
		});
		// A new tier reaches everyone at once: their packs, and their health, topped up.
		subscribe(this.coreAtom, () => {
			for (const player of Players.GetPlayers()) {
				this.sendInventory(player);
				const humanoid = player.Character?.FindFirstChildOfClass("Humanoid");
				if (humanoid && humanoid.Health > 0) humanoid.MaxHealth = humanoid.Health = this.stats().health;
			}
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
	 * Clears the base and, given a map, starts one on it: a Core of the team's tier at the landing,
	 * plus the planet's saved base if it has one, but for what that Core now covers (refunded).
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
		if (this.sandbox()) this.fillPool();

		for (const ore of map.ores) this.ores.set(ore.cell, ore);

		this.placeCore(map, this.coreAtom());

		const rebuilt = new Map<number, Building>();
		for (const old of saved?.buildings ?? []) {
			// A bigger Core than the one that left may stand there now.
			if (footprint(old.cell, BUILDINGS[old.kind].size).some((covered) => this.cells.has(covered))) {
				this.pay(BUILDINGS[old.kind].cost, REFUND);
				continue;
			}
			const building = this.build(map, old.kind, old.cell, old.rotation, old.owner);
			rebuilt.set(old.cell, building);
			building.health = math.min(old.health, building.maxHealth);
			building.stored = old.stored;
			building.filter = old.filter;
			setHealth(building.model, building.health, building.maxHealth);
			if (building.resource !== undefined) building.model.SetAttribute("Stored", old.stored);
			if (old.filter !== undefined) setFilter(building.model, old.filter);
			for (const [resource, amount] of pairs(old.input)) this.hold(building, resource, amount);
		}
		// Links once everything's back, both ends of each.
		for (const old of saved?.buildings ?? []) {
			const building = rebuilt.get(old.cell);
			for (const cell of old.linked) {
				const other = rebuilt.get(cell);
				if (building && other && !building.links.has(other)) this.link(building, other);
			}
		}
	}

	/** What the Core's tier gives everyone (see `coreAtom`). */
	stats() {
		return coreStats(this.coreAtom());
	}

	/** Turns this server into a sandbox (see `sandbox`), with the top tier of Core and the pool filled to its capacity. */
	startSandbox() {
		this.sandbox(true);
		if (this.map && this.core) this.placeCore(this.map, "coreNucleus");
		else this.coreAtom("coreNucleus");
		this.fillPool();
	}

	/** Every resource, up to the Core's capacity. */
	private fillPool() {
		const pool: Stock = {};
		const capacity = this.stats().capacity;
		for (const resource of RESOURCE_ORDER) pool[resource] = capacity;
		this.poolAtom(pool);
	}

	/** Keeps the active planet's base, all but the Core, for when the team comes back to `planet`. */
	save(planet: number) {
		this.saved.set(planet, this.capture());
	}

	/** Every base a world save keeps: those kept for liberated planets and, while the team holds it, the active one. */
	getBases(): ReadonlyMap<number, SavedBase> {
		const bases = new Map<number, SavedBase>();
		for (const [planet, base] of this.saved) bases.set(planet, base);
		const phase = this.phase();
		if (this.map && (phase === "active" || phase === "won")) bases.set(this.map.planet, this.capture());
		return bases;
	}

	/** Puts a world save's bases back. Each is rebuilt when the team next lands on its planet. */
	restore(bases: ReadonlyMap<number, SavedBase>) {
		for (const [planet, base] of bases) this.saved.set(planet, base);
	}

	private capture(): SavedBase {
		const buildings = new Array<SavedBase["buildings"][number]>();
		for (const { kind, cell, rotation, owner, health, stored, filter, input, links } of this.buildings) {
			if (isCore(kind)) continue;
			const linked = new Array<number>();
			for (const other of links) linked.push(other.cell);
			buildings.push({ kind, cell, rotation, owner, health, stored, filter, input: { ...input }, linked });
		}
		return { buildings, pool: { ...this.poolAtom() } };
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
		if (result === "lost") this.coreAtom("core");
		return true;
	}

	/** Hurts a building. At zero it is gone for good, and losing the Core loses the planet. */
	damage(building: Building, amount: number) {
		if (!this.buildings.has(building)) return;
		// A sandbox's Core holds at 1.
		building.health = math.max(building.health - amount, this.sandbox() && building === this.core ? 1 : 0);
		setHealth(building.model, building.health, building.maxHealth);
		if (building === this.core) this.coreHealthAtom(building.health);
		if (building.health > 0) return;

		this.demolish(building);
		if (isCore(building.kind)) this.end("lost");
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
	 * a turret's ammo, a crafter's inputs, a generator's fuel or storage. False when it won't take it;
	 * carriers are `LogisticsService`'s.
	 */
	receive(building: Building, resource: ResourceId): boolean {
		const def = BUILDINGS[building.kind];
		if (building === this.core) {
			if ((this.poolAtom()[resource] ?? 0) >= this.stats().capacity) return false;
			this.pay([{ resource, amount: 1 }], 1);
		} else if (def.turret) {
			const shots = def.turret.ammo[resource]?.shots;
			if (shots === undefined || building.totalAmmo + shots > def.turret.maxAmmo) return false;
			// Mindustry's way: the ore loaded last goes to the back, to fire first.
			const index = building.ammo.findIndex((entry) => entry.resource === resource);
			const entry = index >= 0 ? building.ammo.remove(index)! : { resource, amount: 0 };
			entry.amount += shots;
			building.ammo.push(entry);
			building.totalAmmo += shots;
			setAmmo(building.model, building.totalAmmo, resource);
		} else {
			const held = building.input[resource] ?? 0;
			const limit = def.craft?.storage ?? def.store ?? def.generator?.storage;
			if (limit === undefined || !holds(def, resource) || held >= limit) return false;
			this.hold(building, resource, held + 1);
		}
		return true;
	}

	/** Sets how much of `resource` a building holds (see `Building.input`), and its `Input_` attribute. */
	hold(building: Building, resource: ResourceId, amount: number) {
		building.input[resource] = amount;
		building.model.SetAttribute(`Input_${resource}`, amount);
	}

	/** What the Core or a storage building holds, for an Unloader to take. */
	stock(store: Building): Stock {
		return store === this.core ? this.poolAtom() : store.input;
	}

	/** Takes one `resource` out of the Core or a storage building, for an Unloader. Check `stock` first. */
	release(store: Building, resource: ResourceId) {
		if (store === this.core) this.pay([{ resource, amount: 1 }], -1);
		else this.hold(store, resource, (store.input[resource] ?? 0) - 1);
	}

	/** How a turret's next shot fires: the ore loaded last's, or a power turret's while it has power. Undefined when it can't. */
	nextAmmo(turret: Building): EnergyDef | undefined {
		const gun = BUILDINGS[turret.kind].turret;
		if (gun?.energy) return turret.power > 0 ? gun.energy : undefined;
		const entry = turret.ammo[turret.ammo.size() - 1];
		return entry && gun?.ammo[entry.resource];
	}

	/** Spends one of a turret's shots, of the ore it fires next (see `nextAmmo`). */
	shoot(turret: Building) {
		const entry = turret.ammo[turret.ammo.size() - 1];
		if (!entry) return;
		turret.fired++;
		turret.totalAmmo--;
		entry.amount--;
		if (entry.amount <= 0) turret.ammo.pop();
		// ponytail: an attribute write per shot; write only when an item's worth is spent if fast turrets lag replication.
		setAmmo(turret.model, turret.totalAmmo, turret.ammo[turret.ammo.size() - 1]?.resource);
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
		const given = math.max(0, math.min(amount, this.stats().carry - carried));
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
			capacity: this.stats().carry,
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
		// A sandbox's pool never runs down.
		if (this.sandbox() && scale < 0) return;
		const pool = { ...this.poolAtom() };
		const capacity = this.stats().capacity;
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
	 * it can't, the line stops there and feeds into it. A belt line upgrades slower belts it runs
	 * along. Any other refusal is told once.
	 */
	private place(player: Player, data: unknown) {
		if (!isPlaceData(data) || data.cells.isEmpty() || data.cells.size() > MAX_LINE) return;
		const refuse = (text: string) => this.notify(player, text);
		const map = this.map;
		const def = BUILDINGS[data.kind];
		if (!map || this.phase() !== "active") return refuse("You can't build right now.");
		if (!canBuild(levelsOf(player.UserId), data.kind, this.sandbox())) {
			return refuse(`Research the ${def.name} first.`);
		}
		if (isCore(data.kind)) {
			const reason = this.upgradeCore(player, map, data.kind);
			if (reason !== undefined) refuse(reason);
			return;
		}

		// A belt line keeps the routers and such it runs through (see `replaces`); anything else, or one belt, swaps them out.
		const line = isBelt(data.kind) && data.cells.size() > 1;
		let refusal: string | undefined;
		for (let index = 0; index < data.cells.size(); index++) {
			const { x, z, rotation } = data.cells[index];
			// Crossing happens on the way through, not where a line starts or ends.
			const through = line && index > 0 && index < data.cells.size() - 1;
			const crossed = through ? this.crossable(x, z, rotation % 4) : undefined;
			const reason = crossed
				? this.cross(player, map, crossed)
				: this.placeOne(player, map, data.kind, x, z, rotation % 4, line);
			if (reason !== OCCUPIED || data.cells.size() === 1) refusal ??= reason;
			if (crossed && reason !== undefined) break;
		}
		if (refusal !== undefined) refuse(refusal);
	}

	/** The straight belt on cell (x, z) running across a line heading `rotation`, which a Junction can stand in for. */
	private crossable(x: number, z: number, rotation: number): Building | undefined {
		const belt = this.buildingOn(x, z);
		if (!belt || !isBelt(belt.kind) || belt.rotation % 2 === rotation % 2) return undefined;
		return belt.entry === (belt.rotation + 2) % 4 ? belt : undefined;
	}

	/** Swaps a belt a line crosses for a Junction, the belt refunded like a removal. Returns why not, if it can't. */
	private cross(player: Player, map: PlanetMap, belt: Building): string | undefined {
		if (!canBuild(levelsOf(player.UserId), "junction")) return "Research the Junction to cross belts.";
		if (!this.inReach(player, belt.position)) return "That's too far away to build.";
		const short = this.shortOf(BUILDINGS.junction.cost);
		if (short !== undefined) return short;

		this.demolish(belt);
		this.pay(BUILDINGS[belt.kind].cost, REFUND);
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
	 * Builds `kind` with its -X/-Z corner on cell (x, z), paid from the pool. A belt piece of another
	 * kind there is replaced (see `replaces`, for a belt `line`); a belt replacing a belt keeps its ore.
	 * Returns why not, if it can't.
	 */
	private placeOne(
		player: Player,
		map: PlanetMap,
		kind: BuildableKind,
		x: number,
		z: number,
		rotation: number,
		line: boolean,
	): string | undefined {
		const def = BUILDINGS[kind];
		if (x < 0 || z < 0 || x + def.size > GRID_SIZE || z + def.size > GRID_SIZE) return "That's off the map.";
		const cell = cellIndex(x, z);
		if (!this.inReach(player, cellCenter(cell, def.size))) return "That's too far away to build.";
		const cells = footprint(cell, def.size);
		const there = this.cells.get(cell);
		const replaced = there && replaces(kind, there.kind, line) ? there : undefined;
		if (cells.some((covered) => this.cells.has(covered) && this.cells.get(covered) !== replaced)) return OCCUPIED;
		// Waves land there, so they can't be walled in at the source.
		if (inDropZone(cell, def.size, map.dropZones)) return "You can't build in a drop zone.";
		if (cells.some((covered) => map.isLiquid(cellCenter(covered).X, cellCenter(covered).Z))) {
			return "You can't build on liquid.";
		}
		// Belts go anywhere: they keep their grade and stand on their supports (see `runPaths`).
		const [low, high] = map.groundRange(cell, def.size);
		if (!isBelt(kind) && high - low > MAX_SLOPE) return "The ground is too steep there.";
		if (def.drill && !cells.some((covered) => this.ores.has(covered))) return "Drills must go on ore.";
		const short = this.shortOf(def.cost);
		if (short !== undefined) return short;

		if (replaced) {
			this.demolish(replaced);
			this.pay(BUILDINGS[replaced.kind].cost, REFUND);
		}
		this.pay(def.cost, -1);
		const built = this.build(map, kind, cell, rotation, player.UserId);
		this.autoLink(built);
		if (replaced && isBelt(replaced.kind) && isBelt(kind) && !replaced.items.isEmpty()) {
			for (const item of replaced.items) built.items.push(item);
			const items = built.items.map(({ resource, progress }) => ({ cell, resource, progress }));
			beltMessaging.client.emitAll(BeltMessage.Left, { cell, items });
		}
		return undefined;
	}

	/**
	 * Builds a higher tier of Core over the one standing, Mindustry style, paid from the pool. Its
	 * bigger footprint may cover belt pieces, refunded, but nothing else. Returns why not, if it can't.
	 */
	private upgradeCore(player: Player, map: PlanetMap, kind: CoreKind): string | undefined {
		const core = this.core;
		if (!core) return "There's no Core to build over.";
		if (!replaces(kind, core.kind)) return `You already have a ${BUILDINGS[core.kind].name}.`;
		const def = BUILDINGS[kind];
		const cell = this.coreCell(map, kind);
		if (!this.inReach(player, cellCenter(cell, def.size))) return "That's too far away to build.";
		for (const covered of footprint(cell, def.size)) {
			const there = this.cells.get(covered);
			if (there && !replaces(kind, there.kind)) return "Clear the space round the Core first.";
		}
		const short = this.shortOf(def.cost);
		if (short !== undefined) return short;

		this.pay(def.cost, -1);
		this.placeCore(map, kind);
		this.logger.Info("{Player} built a {Kind}", player.Name, kind);
		for (const other of Players.GetPlayers()) this.notify(other, `${player.Name} built a ${def.name}!`);
		return undefined;
	}

	/** Puts up a `kind` Core round the landing, in place of whatever is there: the old Core, and the rest refunded like a removal. */
	private placeCore(map: PlanetMap, kind: CoreKind) {
		const cell = this.coreCell(map, kind);
		for (const covered of footprint(cell, BUILDINGS[kind].size)) {
			const there = this.cells.get(covered);
			if (!there) continue;
			this.demolish(there);
			if (!isCore(there.kind)) this.pay(BUILDINGS[there.kind].cost, REFUND);
		}
		const core = this.build(map, kind, cell, 0, 0);
		this.core = core;
		this.coreAtom(kind);
		this.coreHealthAtom(core.health);
		this.coreMaxHealthAtom(core.maxHealth);
	}

	/** The -X/-Z corner cell of a `kind` Core: round the landing, a cell corner the Shard's 2×2 cells meet on (see `coreCorner`). */
	private coreCell(map: PlanetMap, kind: CoreKind): number {
		const [x, z] = cellCoords(cellAt(map.landing.X - CELL_STUDS / 2, map.landing.Z - CELL_STUDS / 2)!);
		const [cx, cz] = coreCorner(x, z, BUILDINGS.core.size, BUILDINGS[kind].size);
		return cellIndex(cx, cz);
	}

	/** Turns a building a quarter turn, free. A belt then carries the new way. */
	private rotate(player: Player, data: unknown) {
		if (!isCellData(data)) return;
		const map = this.map;
		if (!map || this.phase() !== "active") return this.notify(player, "You can't turn anything right now.");
		const building = this.buildingOn(data.x, data.z);
		if (!building || isCore(building.kind)) return;
		if (!this.inReach(player, building.position)) return this.notify(player, "That's too far away to turn.");

		building.rotation = (building.rotation + 1) % 4;
		// A belt is remade with its neighbours, which its new way can change.
		if (!isBelt(building.kind)) this.dress(map, building);
		this.refreshAround(building);
	}

	/** Sets the ore a Sorter lets straight through, a Source hands out or an Unloader takes, or none. */
	private configure(player: Player, data: unknown) {
		if (!isCellOreData(data) || this.phase() !== "active") return;
		const building = this.buildingOn(data.x, data.z);
		if (!building || !FILTERED.has(building.kind)) return;
		if (!this.inReach(player, building.position)) return this.notify(player, "That's too far away to set.");
		building.filter = data.resource;
		setFilter(building.model, data.resource);
	}

	/** Links a power node to a building in its range, or unlinks them if they're linked. */
	private toggleLink(player: Player, data: unknown) {
		if (!isLinkData(data) || this.phase() !== "active") return;
		const node = this.buildingOn(data.x, data.z);
		const other = this.buildingOn(data.toX, data.toZ);
		if (!node || !other || node === other || BUILDINGS[node.kind].node === undefined || !isPowered(other.kind))
			return;
		if (!this.inReach(player, node.position)) return this.notify(player, "That's too far away to link.");
		if (node.links.has(other)) return this.unlink(node, other);
		if (!linkReach(node.kind, node.cell, other.kind, other.cell)) {
			return this.notify(player, "That's out of the node's range.");
		}
		if (this.full(node) || this.full(other)) return this.notify(player, "That node has no links to spare.");
		this.link(node, other);
	}

	/**
	 * Links a building just placed, Mindustry style. A node links what's in its range, nearest first,
	 * skipping what's already on its network, until it has no links to spare. Anything else on the
	 * power network links to the nearest node in range with one to spare.
	 */
	private autoLink(building: Building) {
		if (!isPowered(building.kind)) return;
		const near = new Array<Building>();
		for (const other of this.buildings) {
			if (other === building || !isPowered(other.kind)) continue;
			if (linkReach(building.kind, building.cell, other.kind, other.cell)) near.push(other);
		}
		const distance = (other: Building) => other.position.sub(building.position).Magnitude;
		near.sort((a, b) => distance(a) < distance(b));
		if (BUILDINGS[building.kind].node === undefined) {
			const node = near.find((other) => BUILDINGS[other.kind].node !== undefined && !this.full(other));
			if (node) this.link(node, building);
			return;
		}
		for (const other of near) {
			if (this.full(building)) break;
			if (!this.full(other) && !powerNetwork(building).has(other)) this.link(building, other);
		}
	}

	/** Whether a node has made every link it can. Anything else takes any number. */
	private full(building: Building): boolean {
		const most = BUILDINGS[building.kind].node;
		return most !== undefined && building.links.size() >= most;
	}

	private link(a: Building, b: Building) {
		a.links.add(b);
		b.links.add(a);
		this.drawLinks(a);
		this.drawLinks(b);
	}

	private unlink(a: Building, b: Building) {
		a.links.delete(b);
		b.links.delete(a);
		this.drawLinks(a);
		this.drawLinks(b);
	}

	/** Redraws a node's links (see `linkLines`) and writes their count. A link between two nodes is drawn by the one on the lower cell. */
	private drawLinks(building: Building) {
		if (BUILDINGS[building.kind].node === undefined) return;
		const tip = (of: Building) => {
			const part = of.model.FindFirstChild("Tip");
			return part?.IsA("BasePart") ? part.Position : of.position;
		};
		const ends = new Array<Vector3>();
		for (const other of building.links) {
			if (BUILDINGS[other.kind].node === undefined || other.cell > building.cell) ends.push(tip(other));
		}
		linkLines(building.model, tip(building), ends);
		building.model.SetAttribute("Links", building.links.size());
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
		if (isCore(building.kind)) return refuse("The Core can't be removed.");
		if (!this.inReach(player, building.position)) return refuse("That's too far away to remove.");

		this.demolish(building);
		this.pay(BUILDINGS[building.kind].cost, REFUND);
	}

	/** Builds without any checks; `place` does those. */
	private build(map: PlanetMap, kind: BuildingKind, cell: number, rotation: number, owner: number): Building {
		const def = BUILDINGS[kind];
		const maxHealth = isCore(kind) ? def.health : math.round(def.health * statOf(owner, "buildingHealth"));
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
			burst: 0,
			spin: 0,
			burning: 0,
			engaged: false,
			aim: [(rotation * math.pi) / 2, 0],
			retarget: 0,
			muzzles: [],
			resource: def.drill ? this.oreUnder(cell, def.size) : def.craft?.output,
			stored: 0,
			entry: (rotation + 2) % 4,
			items: [],
			ammo: [],
			totalAmmo: 0,
			fired: 0,
			input: {},
			turn: 0,
			look: "",
			links: new Set(),
			power: 0,
			charge: 0,
			burn: 0,
			efficiency: 0,
			work: 0,
		};
		if (building.resource !== undefined) {
			model.SetAttribute("Resource", building.resource);
			model.SetAttribute("Stored", 0);
		}
		if (def.drill) model.SetAttribute("Yield", this.drillYield(building));
		for (const { resource } of def.craft?.inputs ?? []) model.SetAttribute(`Input_${resource}`, 0);
		for (const [resource] of pairs(def.generator?.fuel ?? {})) model.SetAttribute(`Input_${resource}`, 0);
		this.buildings.add(building);
		for (const covered of footprint(cell, def.size)) this.cells.set(covered, building);
		this.revision++;

		const [low, high] = map.groundRange(cell, def.size);
		const center = cellCenter(cell, def.size);
		this.clearProps(map, new Vector3(center.X, high + GROUND_CLEARANCE, center.Z), def.size * CELL_STUDS, low);
		// A belt is made with its run, once it's in (see `reshape`).
		if (isBelt(kind)) building.entry = this.beltEntry(building);
		else this.dress(map, building);
		model.Parent = this.buildingsFolder;
		this.refreshAround(building);
		return building;
	}

	/** The ore under most of a `size`-wide footprint from `cell`, if any. */
	private oreUnder(cell: number, size: number): ResourceId | undefined {
		const counts = new Map<ResourceId, number>();
		let most: ResourceId | undefined;
		for (const covered of footprint(cell, size)) {
			const resource = this.ores.get(covered)?.resource;
			if (resource === undefined) continue;
			const count = (counts.get(resource) ?? 0) + 1;
			counts.set(resource, count);
			if (most === undefined || count > counts.get(most)!) most = resource;
		}
		return most;
	}

	/** What a drill mines each tick: its yield, with its owner's research, for each cell of its ore under it. */
	private drillYield(drill: Building): number {
		const def = BUILDINGS[drill.kind];
		const cells = footprint(drill.cell, def.size).filter(
			(covered) => this.ores.get(covered)?.resource === drill.resource,
		);
		return ((def.drill?.yield ?? 0) + statOf(drill.owner, "drillYield")) * cells.size();
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
		if (isBelt(kind)) {
			const path = building.path!;
			const [look, key] = this.beltLook(building);
			building.look = key;
			body = beltModel(model, kind, path, map.heightAt, look);
			model.SetAttribute("Entry", building.entry);
			model.SetAttribute("PathIn", path[0]);
			model.SetAttribute("PathMid", path[1]);
			model.SetAttribute("PathOut", path[2]);
			model.SetAttribute("PathEnds", path[3]);
		} else {
			const center = cellCenter(building.cell, def.size);
			const top = new Vector3(center.X, high + GROUND_CLEARANCE, center.Z);
			const color = building.resource !== undefined ? RESOURCES[building.resource].color : undefined;
			// Walls reach out to the walls beside them.
			const joined = DIRECTIONS.map((_, side) => {
				const other = def.wall ? this.neighbour(building.cell, side) : undefined;
				return other !== undefined && BUILDINGS[other.kind].wall === true;
			});
			const [made, head, muzzles] = buildingModel(model, kind, top, low - 2, building.rotation, color, joined);
			body = made;
			building.head = head;
			building.muzzles = muzzles;
		}
		model.SetAttribute("Rotation", building.rotation);
		building.position = body.Position;
		setHealth(model, building.health, building.maxHealth);
		if (def.turret && !def.turret.energy) {
			setAmmo(model, building.totalAmmo, building.ammo[building.ammo.size() - 1]?.resource);
		}
		if (FILTERED.has(kind)) setFilter(model, building.filter);
		if (def.power !== undefined) setPower(model, building.power);
		this.drawLinks(building);
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
		return ahead && isBelt(ahead.kind) && ahead.rotation !== back && ahead.entry !== back ? ahead : undefined;
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
			return prior && isBelt(prior.kind) && prior.rotation === (other.entry + 2) % 4 ? prior : undefined;
		};
		const after = (other: Building) => {
			const onward = this.neighbour(other.cell, other.rotation);
			return onward && isBelt(onward.kind) && onward.entry === (other.rotation + 2) % 4 ? onward : undefined;
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
					if (side === member.entry || !feeder || !isBelt(feeder.kind) || feeder.rotation !== (side + 2) % 4)
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
	 * belt anywhere in one can raise the rest. A wall's neighbouring walls reach to it, or stop.
	 * Deferred: whatever else is built or taken down this frame (a dragged line, a blast) joins in, and
	 * it all runs once, after.
	 */
	private refreshAround(building: Building) {
		const walls = new Set<Building>();
		if (BUILDINGS[building.kind].wall) {
			for (const [other] of this.around(building)) if (BUILDINGS[other.kind].wall) walls.add(other);
		}
		const [gx, gz] = cellCoords(building.cell);
		const size = BUILDINGS[building.kind].size;
		const near = new Set<Building>();
		for (let z = gz - 2; z < gz + size + 2; z++) {
			for (let x = gx - 2; x < gx + size + 2; x++) {
				const belt = this.buildingOn(x, z);
				if (belt && isBelt(belt.kind)) near.add(belt);
			}
		}
		// Every shape first: which belts make a run depends on them. Cheap, so done now, current for the next build this frame.
		for (const belt of near) belt.entry = this.beltEntry(belt);
		if (!this.pending) {
			const pending = { belts: new Set<Building>(), walls: new Set<Building>() };
			this.pending = pending;
			task.defer(() => {
				this.pending = undefined;
				if (this.map) this.remake(this.map, pending.belts, pending.walls);
			});
		}
		for (const belt of near) this.pending.belts.add(belt);
		for (const wall of walls) this.pending.walls.add(wall);
	}

	/** Redresses `walls` and lays out again the runs `belts` are in (see `reshape`): those still standing. */
	private remake(map: PlanetMap, belts: ReadonlySet<Building>, walls: ReadonlySet<Building>) {
		for (const wall of walls) if (this.buildings.has(wall)) this.dress(map, wall);
		this.reshape(map, belts);
	}

	/** The building covering cell (x, z), if any. */
	private buildingOn(x: number, z: number): Building | undefined {
		if (x < 0 || z < 0 || x >= GRID_SIZE || z >= GRID_SIZE) return undefined;
		return this.cells.get(cellIndex(x, z));
	}

	private demolish(building: Building) {
		for (const other of building.links) {
			other.links.delete(building);
			this.drawLinks(other);
		}
		building.links.clear();
		building.model.Destroy();
		this.buildings.delete(building);
		for (const covered of footprint(building.cell, BUILDINGS[building.kind].size)) this.cells.delete(covered);
		if (building === this.core) this.core = undefined;
		this.revision++;
		this.refreshAround(building);
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

	/** Mines one ore from the deposit on a cell, for a held click: in reach, not built over, an ore the Core's tier can mine, and no faster than it allows. */
	private mine(player: Player, data: unknown) {
		if (!isCellData(data) || this.phase() !== "active") return;
		if (data.x < 0 || data.z < 0 || data.x >= GRID_SIZE || data.z >= GRID_SIZE) return;
		const cell = cellIndex(data.x, data.z);
		const ore = this.ores.get(cell);
		if (!ore || this.cells.has(cell) || !this.inReach(player, cellCenter(cell), TRANSFER_RANGE)) return;
		// The client explains a refused ore, so a held click doesn't flood toasts.
		const { mines, mineSeconds } = this.stats();
		if (!mines.includes(ore.resource)) return;
		const now = os.clock();
		if (now - (this.lastMined.get(player) ?? -math.huge) < mineSeconds - MINE_SLACK) return;
		this.lastMined.set(player, now);
		if (this.give(player, ore.resource, 1) === 0) this.notify(player, FULL);
	}

	/** The building covering a cell a player wants to move items in or out of, if they're close enough to. */
	reachable(player: Player, data: unknown): Building | undefined {
		if (!isCellData(data) || this.phase() !== "active") return undefined;
		const building = this.buildingOn(data.x, data.z);
		if (building && !this.inReach(player, building.position, TRANSFER_RANGE)) {
			this.notify(player, "That's too far away. Move closer.");
			return undefined;
		}
		return building;
	}

	/**
	 * Moves what a drill or crafter has made, what storage holds, or the ore on a belt (just `only`,
	 * if given), into a player's pack, as much as fits.
	 */
	private collect(player: Player, building: Building, only?: ResourceId) {
		if (!this.buildings.has(building)) return;
		if (isBelt(building.kind)) return this.takeOff(player, building, only);
		if (BUILDINGS[building.kind].store !== undefined) return this.empty(player, building);
		if (building.resource === undefined) return;
		if (building.stored === 0) return this.notify(player, "Nothing to collect yet.");
		building.stored -= this.give(player, building.resource, building.stored);
		building.model.SetAttribute("Stored", building.stored);
		if (building.stored > 0) this.notify(player, FULL);
	}

	/** Moves everything a storage building holds into a player's pack, as much as fits. */
	private empty(player: Player, store: Building) {
		let found = false;
		let full = false;
		for (const resource of RESOURCE_ORDER) {
			const held = store.input[resource] ?? 0;
			if (held === 0) continue;
			found = true;
			const given = this.give(player, resource, held);
			this.hold(store, resource, held - given);
			full ||= given < held;
		}
		if (!found) this.notify(player, "Nothing to collect yet.");
		else if (full) this.notify(player, FULL);
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
	 * (see `deposit`) or storage, ammo into a turret, its inputs into a crafter, fuel into a
	 * generator. The rest stays carried.
	 */
	private load(player: Player, building: Building) {
		if (!this.buildings.has(building)) return;
		if (building === this.core) return this.deposit(player);
		const def = BUILDINGS[building.kind];
		if (def.turret?.energy) return this.notify(player, "It runs on power, not ammo.");
		if (!def.turret && !def.craft && def.store === undefined && !def.generator?.fuel) return;
		const left: Stock = {};
		let loaded = 0;
		let carried = 0;
		for (const [resource, amount] of pairs(this.inventories.get(player) ?? {})) {
			let kept = amount;
			while (kept > 0 && this.receive(building, resource)) kept--;
			loaded += amount - kept;
			carried += amount;
			if (kept > 0) left[resource] = kept;
		}
		if (loaded > 0) return this.setInventory(player, left);
		if (def.store !== undefined)
			return this.notify(player, carried > 0 ? "It's full." : "You have nothing to store.");
		const turret = def.turret;
		const room = (turret?.maxAmmo ?? 0) - building.totalAmmo;
		const limit = def.craft?.storage ?? def.generator?.storage ?? 0;
		const takes = RESOURCE_ORDER.filter((resource) =>
			turret ? turret.ammo[resource] !== undefined : holds(def, resource),
		);
		const full = turret
			? takes.every((resource) => turret.ammo[resource]!.shots > room)
			: takes.every((resource) => (building.input[resource] ?? 0) >= limit);
		const need = `Carry ${takes.map((resource) => RESOURCES[resource].name).join(", ")} to load it.`;
		this.notify(player, full ? "It's fully loaded." : need);
	}

	/** Moves a player's inventory into the pool, as much as the Core has room for. The rest stays carried. */
	private deposit(player: Player) {
		const items = this.inventories.get(player) ?? {};
		const pool = this.poolAtom();
		const capacity = this.stats().capacity;
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
		if (kept > 0) this.notify(player, "The Core is full. Upgrade it for more room.");
	}

	/**
	 * Drills mine, crafters craft, and menders repair every damaged building in their range. What
	 * needs power goes slower on less: a drill or crafter goes once it's had a full tick's worth, and
	 * a mender repairs its share.
	 */
	private runMachines() {
		for (const building of this.buildings) {
			const def = BUILDINGS[building.kind];
			const share = def.power !== undefined ? building.power : 1;
			building.work = math.min(building.work + share, 1);
			const ready = building.work >= 1;
			if (def.drill && building.resource !== undefined) {
				// Follows its owner's research as it comes in.
				const mined = this.drillYield(building);
				building.model.SetAttribute("Yield", mined);
				if (ready && building.stored < def.drill.storage) {
					building.stored = math.min(building.stored + mined, def.drill.storage);
					building.model.SetAttribute("Stored", building.stored);
					building.work = 0;
				}
			}
			const craft = def.craft;
			const stocked = craft?.inputs.every(({ resource, amount }) => (building.input[resource] ?? 0) >= amount);
			if (craft && stocked && ready && building.stored < craft.storage) {
				for (const { resource, amount } of craft.inputs) {
					this.hold(building, resource, (building.input[resource] ?? 0) - amount);
				}
				building.stored++;
				building.model.SetAttribute("Stored", building.stored);
				building.work = 0;
			}
			if (def.repair !== undefined && def.range !== undefined && share > 0) {
				for (const other of this.buildings) {
					if (other.position.sub(building.position).Magnitude <= def.range) {
						this.repair(other, def.repair * share);
					}
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
}
