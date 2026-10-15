import { MessageEmitter } from "@rbxts/tether";

import type { BuildableKind } from "game/Base/shared/buildings";
import type { ResourceId, ResourceStack } from "game/Base/shared/resources";

/** The defend mission on the active planet. Ids start at 110, clear of core's and Planets' (100+). */
export const baseMessaging = MessageEmitter.create<BaseMessageData>();

export const enum BaseMessage {
	Request = 110,
	State,
	Inventory,
	Notice,
	Place,
	Remove,
	CallWave,
	Fire,
	Rotate,
	Mine,
	Collect,
	Load,
	Drop,
	Ping,
	Pinged,
	Link,
}

/**
 * - `idle`: no planet is active yet.
 * - `generating`: the active planet's terrain is being written.
 * - `active`: the base is running. Aliens are attacking when `aliens > 0`; a liberated planet has none.
 * - `won` / `lost`: the result banner. A win goes back to `active`, liberated; a loss retreats the team.
 * - `travelling`: the core is launching, in transit or landing. Nothing can be built and the aliens wait.
 */
export type Phase = "idle" | "generating" | "active" | "won" | "lost" | "travelling";

export interface BaseState {
	readonly phase: Phase;
	/** Index into `generateStarSystem(seed).planets`, or -1 while idle. */
	readonly planet: number;
	/** Whether the active planet is liberated: no waves, just the base. */
	readonly liberated: boolean;
	/** A sandbox: everything unlocked, a pool that never runs down, and aliens only when called (see `sandboxMessaging`). */
	readonly sandbox: boolean;
	/** Waves launched so far, and how many the planet has. */
	readonly wave: number;
	readonly waves: number;
	/** `Workspace.GetServerTimeNow()` when the next wave launches, or 0 when none is coming. */
	readonly nextWaveAt: number;
	readonly aliens: number;
	readonly coreHealth: number;
	readonly coreMaxHealth: number;
	/** The Core's storage: every resource this planet has, in `RESOURCE_ORDER`, zeros included. */
	readonly pool: ReadonlyArray<ResourceStack>;
	/** The most of each resource deposits can fill the pool to. */
	readonly capacity: number;
	/** Where aliens land: the centre of each drop zone, on the ground (see `DROP_ZONE_RADIUS`). None without a map. */
	readonly dropZones: ReadonlyArray<Vector3>;
	/** How much of `planet`'s terrain is generated, 0 to 1: the loading overlay's bar while it generates. */
	readonly generated: number;
}

export interface BaseMessageData {
	/** Client -> server: send me the state and my inventory. */
	[BaseMessage.Request]: undefined;
	/** Server -> client(s): whenever any of it changes. */
	[BaseMessage.State]: BaseState;
	/** Server -> client: what this player carries (non-zero stacks only). */
	[BaseMessage.Inventory]: { readonly items: ReadonlyArray<ResourceStack>; readonly capacity: number };
	/** Server -> client: a short toast, e.g. why a build was refused. */
	[BaseMessage.Notice]: { readonly text: string };
	/** Client -> server: build `kind` on each cell, in order: one, or a dragged line of up to `MAX_LINE`. */
	[BaseMessage.Place]: { readonly kind: BuildableKind; readonly cells: ReadonlyArray<Placement> };
	/** Client -> server: remove whichever building covers cell (x, z). */
	[BaseMessage.Remove]: { readonly x: number; readonly z: number };
	/** Client -> server: launch the next wave now. */
	[BaseMessage.CallWave]: undefined;
	/** Client -> server: the equipped Blaster fired at this world point. The server raycasts from the Blaster. */
	[BaseMessage.Fire]: { readonly target: Vector3 };
	/** Client -> server: turn whichever building covers cell (x, z) a quarter turn. */
	[BaseMessage.Rotate]: { readonly x: number; readonly z: number };
	/** Client -> server, every `MINE_SECONDS` while a click is held on it: mine one ore from the deposit on cell (x, z). */
	[BaseMessage.Mine]: { readonly x: number; readonly z: number };
	/** Client -> server: take what the drill or crafter covering cell (x, z) has made, or the ore on the belt there: just `resource`, if given. */
	[BaseMessage.Collect]: { readonly x: number; readonly z: number; readonly resource?: ResourceId };
	/** Client -> server: from my pack into the building covering cell (x, z): all of it into the Core, ammo into a turret, inputs into a crafter. */
	[BaseMessage.Load]: { readonly x: number; readonly z: number };
	/** Client -> server: throw away all of `resource` that I carry. */
	[BaseMessage.Drop]: { readonly resource: ResourceId };
	/** Client -> server: show everyone every alien. */
	[BaseMessage.Ping]: undefined;
	/** Server -> clients: someone pinged, so show every alien for a while (see `PingController`). */
	[BaseMessage.Pinged]: undefined;
	/** Client -> server: link the power node covering cell (x, z) to the building covering (toX, toZ), or unlink them if they are. */
	[BaseMessage.Link]: { readonly x: number; readonly z: number; readonly toX: number; readonly toZ: number };
}

/** One building to place: its -X/-Z corner on cell (x, z), turned `rotation` quarter turns (0-3, see `DIRECTIONS`). */
export interface Placement {
	readonly x: number;
	readonly z: number;
	readonly rotation: number;
}

/** Ore moving between buildings. Its own emitter, so it has ids to spare: 140+. */
export const beltMessaging = MessageEmitter.create<BeltMessageData>();

export const enum BeltMessage {
	Request = 140,
	Contents,
	Moves,
	Configure,
	Left,
}

/**
 * Ore leaving the building on cell `from` for the one on `to` (their -X/-Z corner cells), passing
 * any sorters and junctions between. On a belt it joins `at` along it: 0 at the back, or near the
 * middle from a side.
 */
export interface ItemMove {
	readonly from: number;
	readonly to: number;
	readonly resource: ResourceId;
	readonly at: number;
}

/** Ore on the building on `cell`: a belt, `progress` along it from 0 at the back to 1 at the front, or a router. */
export interface HeldItem {
	readonly cell: number;
	readonly resource: ResourceId;
	readonly progress: number;
}

export interface BeltMessageData {
	/** Client -> server: send me the ore on the belts. */
	[BeltMessage.Request]: undefined;
	/** Server -> client: the ore on every belt and in every router. */
	[BeltMessage.Contents]: { readonly items: ReadonlyArray<HeldItem> };
	/** Server -> clients, each tick ore moved: where it went. */
	[BeltMessage.Moves]: { readonly moves: ReadonlyArray<ItemMove> };
	/** Client -> server: the ore the Sorter on cell (x, z) lets straight through, or none. */
	[BeltMessage.Configure]: { readonly x: number; readonly z: number; readonly resource?: ResourceId };
	/** Server -> clients, when ore is taken off a belt by hand: all that's left on the building on `cell`. */
	[BeltMessage.Left]: { readonly cell: number; readonly items: ReadonlyArray<HeldItem> };
}

/** The aliens that walk, and those that fly, in the order the sandbox panel lists them. */
export const GROUND_ALIENS = [
	"crawler",
	"sapper",
	"brute",
	"spitter",
	"mortar",
	"shielder",
	"strider",
	"aegis",
	"hydra",
	"fortress",
	"titan",
] as const;
export const AIR_ALIENS = [
	"drone",
	"wasp",
	"hornet",
	"bomber",
	"gunship",
	"carrier",
	"frigate",
	"dreadnought",
] as const;
/** Every kind of alien. */
export const ALIEN_KINDS = [...GROUND_ALIENS, ...AIR_ALIENS] as const;
export type AlienKind = (typeof ALIEN_KINDS)[number];

/** Turret and alien shots, for clients to draw: the server deals their damage. Its own emitter: 150+. */
export const shotMessaging = MessageEmitter.create<ShotMessageData>();

export const enum ShotMessage {
	Fired = 150,
	Hit,
	Blast,
	Downed,
	Beam,
	Arc,
}

/**
 * A bullet, flame, rocket, shell or burst of flak, flying a curve from `from` that bends toward
 * `control` (see `bezier`; straight for bullets, flames and flak), for `seconds`.
 */
export interface Shot {
	/** Which shot it is, so one shot down in the air can be told apart. */
	readonly id: number;
	readonly kind: "bullet" | "flame" | "rocket" | "shell" | "flak";
	readonly from: Vector3;
	readonly control: Vector3;
	/** Where it lands, unless it chases `target` while that lives. */
	readonly to: Vector3;
	readonly target?: Model;
	readonly seconds: number;
	/** Its blast's radius, in studs. */
	readonly splash: number;
	/** Bullets and flames: how heavy they look, the size of the turret that fired them. */
	readonly size?: number;
	/** A turret's: the turret, and which of its barrels fired it, to kick back (see `TurretController`). */
	readonly turret?: Model;
	readonly barrel?: number;
}

export interface ShotMessageData {
	/** Server -> clients: a turret fired a bullet, flame, rocket, shell or flak, or an alien a shell, bomb or rocket. */
	[ShotMessage.Fired]: Shot;
	/**
	 * Server -> clients: an alien's shot hit at once, from its barrel at `from` to `to`. `size` is how
	 * heavy it looks: 2 and up also blast.
	 */
	[ShotMessage.Hit]: { readonly from: Vector3; readonly to: Vector3; readonly size: number; readonly hostile?: true };
	/** Server -> clients: something blew up on the spot, hurting what was within `splash` studs. */
	[ShotMessage.Blast]: { readonly at: Vector3; readonly splash: number };
	/** Server -> clients: an alien's point defence shot the shot `id` down in the air, from its barrel at `from`. */
	[ShotMessage.Downed]: { readonly id: number; readonly from: Vector3 };
	/** Server -> clients: a laser `turret`'s beam burned from `from` to `to` (one pulse of many), drawn `reach` (0 to 1) of the way out. */
	[ShotMessage.Beam]: {
		readonly turret: Model;
		readonly from: Vector3;
		readonly to: Vector3;
		readonly reach: number;
	};
	/** Server -> clients: lightning leapt through `points`, from a turret's coil to each alien it struck in turn. */
	[ShotMessage.Arc]: { readonly points: ReadonlyArray<Vector3> };
}

/** The point `t` (0 to 1) of the way along a shot's curve: a quadratic Bézier from `from` bending toward `control`. */
export function bezier(from: Vector3, control: Vector3, to: Vector3, t: number): Vector3 {
	return from.Lerp(control, t).Lerp(control.Lerp(to, t), t);
}

/** A sandbox's controls, refused anywhere else. Its own emitter: 160+. */
export const sandboxMessaging = MessageEmitter.create<SandboxMessageData>();

export const enum SandboxMessage {
	Spawn = 160,
	Clear,
}

export interface SandboxMessageData {
	/** Client -> server: send `count` aliens of `kind` from the drop zones. */
	[SandboxMessage.Spawn]: { readonly kind: AlienKind; readonly count: number };
	/** Client -> server: kill every alien, and those waiting to spawn. */
	[SandboxMessage.Clear]: undefined;
}
