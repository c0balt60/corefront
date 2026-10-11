import { Controller, OnStart } from "@flamework/core";
import { effect } from "@rbxts/charm";
import { RunService, Workspace } from "@rbxts/services";

import { selectedAtom, selectedOreAtom } from "game/Base/client/base-state";
import { BeltMessage, beltMessaging, type HeldItem, type ItemMove } from "game/Base/shared/base-network";
import { alongPath, BELT_SPACING, modelPath } from "game/Base/shared/belts";
import { BUILDINGS, type BuildingKind } from "game/Base/shared/buildings";
import { type ResourceId, RESOURCES } from "game/Base/shared/resources";

/** An ore's size, in studs. */
const ORE_SIZE = 1.2;
/** How hard drawn ore eases toward where it should be. Smooths every hop between buildings. */
const CATCH_UP = 14;
/** Seconds ore takes to sink into whatever took it in. */
const SWALLOW_SECONDS = 0.35;
/** How high over a router's middle the ore it holds sits. */
const HELD_HEIGHT = 2;

/** One ore, as drawn. */
interface Ore {
	readonly part: Part;
	resource: ResourceId;
	/** Along its belt, from 0 at the back to 1 at the front, run by the same rules as the server's. */
	progress: number;
	/** Where it's drawn: easing toward where `progress` puts it. */
	position: Vector3;
	heading: Vector3;
}

/**
 * Draws the ore on the belts. The server sends every move (see `LogisticsService`); between them,
 * each client runs its belts by the same rules, so ore glides instead of ticking along. Also keeps
 * `selectedOreAtom` for the selected belt's panel.
 */
@Controller()
export class LogisticsController implements OnStart {
	private readonly folder = new Instance("Folder");
	/** Every building's model, by its -X/-Z corner cell. */
	private readonly models = new Map<number, Model>();
	/** The ore on each belt, back to front. */
	private readonly belts = new Map<number, Array<Ore>>();
	/** The ore each router holds. */
	private readonly held = new Map<number, Ore>();
	/** Ore sinking into what took it in, until it's gone. */
	private swallowed = new Array<{ readonly ore: Ore; readonly into: Vector3; readonly gone: number }>();

	onStart() {
		this.folder.Name = "BeltOre";
		this.folder.Parent = Workspace;
		beltMessaging.client.on(BeltMessage.Moves, ({ moves }) => {
			moves.forEach((move) => this.move(move));
			this.publish();
		});
		beltMessaging.client.on(BeltMessage.Contents, ({ items }) => {
			this.fill(items);
			this.publish();
		});
		beltMessaging.client.on(BeltMessage.Left, ({ cell, items }) => {
			this.drop(cell);
			items.forEach((item) => this.put(item));
			this.publish();
		});
		effect(() => this.publish());
		RunService.RenderStepped.Connect((dt) => this.render(dt));

		task.spawn(() => {
			const buildings = Workspace.WaitForChild("Base").WaitForChild("Buildings");
			buildings.ChildAdded.Connect((child) => this.added(child));
			buildings.ChildRemoved.Connect((child) => this.removed(child));
			buildings.GetChildren().forEach((child) => this.added(child));
			beltMessaging.server.emit(BeltMessage.Request);
		});
	}

	private added(child: Instance) {
		const cell = child.GetAttribute("Cell");
		if (!child.IsA("Model") || !typeIs(cell, "number")) return;
		this.models.set(cell, child);
	}

	private removed(child: Instance) {
		const cell = child.GetAttribute("Cell");
		if (!typeIs(cell, "number") || this.models.get(cell) !== child) return;
		this.models.delete(cell);
		this.drop(cell);
	}

	/** Moves an ore from one building to another: the front one off a belt, or a router's, or a new one from a drill. */
	private move({ from, to, resource, at: joined }: ItemMove) {
		const at = (this.models.get(from) ?? this.models.get(to))?.GetPivot().Position;
		const ore = this.take(from) ?? (at && this.make(resource, at));
		if (!ore) return;
		ore.resource = resource;
		ore.part.Color = RESOURCES[resource].color;
		this.land(to, ore, joined);
	}

	/** Draws everything the server says is on the belts and in the routers, instead of what's drawn. */
	private fill(items: ReadonlyArray<HeldItem>) {
		for (const [cell] of this.belts) this.drop(cell);
		for (const [cell] of this.held) this.drop(cell);
		items.forEach((item) => this.put(item));
	}

	/** Draws ore where the server says it sits: `progress` along a belt, or held by a router. */
	private put({ cell, resource, progress }: HeldItem) {
		const model = this.models.get(cell);
		const path = model && modelPath(model);
		const at = path ? alongPath(path, progress)[0] : model?.GetPivot().Position;
		if (at) this.land(cell, this.make(resource, at), progress);
	}

	/** Tells `selectedOreAtom` what's drawn on the selected building. Run in an effect, it runs again whenever that changes. */
	private publish() {
		const cell = selectedAtom()?.GetAttribute("Cell");
		const ores = typeIs(cell, "number") ? this.belts.get(cell) : undefined;
		selectedOreAtom(ores?.map((ore) => ore.resource) ?? []);
	}

	/** Puts ore on the building on `cell`: `progress` along a belt, held by a router, or sinking into anything else. */
	private land(cell: number, ore: Ore, progress: number) {
		const model = this.models.get(cell);
		const kind = model?.GetAttribute("Kind") as BuildingKind | undefined;
		if (!model) {
			ore.part.Destroy();
		} else if (kind !== undefined && BUILDINGS[kind]?.belt !== undefined) {
			ore.progress = progress;
			const ores = this.belts.get(cell) ?? [];
			this.belts.set(cell, ores);
			const index = ores.findIndex((other) => other.progress > progress);
			if (index < 0) ores.push(ore);
			else ores.insert(index, ore);
		} else if (kind === "router") {
			this.held.get(cell)?.part.Destroy();
			this.held.set(cell, ore);
		} else {
			this.swallowed.push({ ore, into: model.GetPivot().Position, gone: os.clock() + SWALLOW_SECONDS });
		}
	}

	/** Takes the ore a router holds, or the front one off a belt. */
	private take(cell: number): Ore | undefined {
		const held = this.held.get(cell);
		this.held.delete(cell);
		return held ?? this.belts.get(cell)?.pop();
	}

	private make(resource: ResourceId, at: Vector3): Ore {
		const part = new Instance("Part");
		part.Anchored = true;
		part.CanCollide = false;
		part.CanQuery = false;
		part.CanTouch = false;
		part.CastShadow = false;
		part.Size = new Vector3(ORE_SIZE, ORE_SIZE, ORE_SIZE);
		part.Material = Enum.Material.SmoothPlastic;
		part.Color = RESOURCES[resource].color;
		part.CFrame = new CFrame(at);
		part.Parent = this.folder;
		return { part, resource, progress: 0, position: at, heading: new Vector3(0, 0, -1) };
	}

	/** Clears the ore drawn on the building on `cell`. */
	private drop(cell: number) {
		this.belts.get(cell)?.forEach((ore) => ore.part.Destroy());
		this.belts.delete(cell);
		this.held.get(cell)?.part.Destroy();
		this.held.delete(cell);
	}

	private render(dt: number) {
		const parts = new Array<BasePart>();
		const frames = new Array<CFrame>();
		const ease = 1 - math.exp(-CATCH_UP * dt);
		const draw = (ore: Ore, goal: Vector3, heading: Vector3) => {
			ore.position = ore.position.Lerp(goal, ease);
			if (heading.Magnitude > 0.01) ore.heading = heading;
			parts.push(ore.part);
			// Resting on the belt and square to it, however it tilts.
			const look = CFrame.lookAt(ore.position, ore.position.add(ore.heading));
			frames.push(look.mul(new CFrame(0, ORE_SIZE / 2, 0)));
		};

		for (const [cell, ores] of this.belts) {
			// ponytail: reads four attributes per busy belt per frame; cache on AttributeChanged if bases get huge.
			const model = !ores.isEmpty() ? this.models.get(cell) : undefined;
			const path = model && modelPath(model);
			const speed = model && BUILDINGS[model.GetAttribute("Kind") as BuildingKind]?.belt;
			if (!path || speed === undefined) continue;
			for (let i = ores.size() - 1; i >= 0; i--) {
				const ore = ores[i];
				const limit = i === ores.size() - 1 ? 1 : ores[i + 1].progress - BELT_SPACING;
				ore.progress = math.max(ore.progress, math.min(ore.progress + speed * dt, limit));
				const [goal, heading] = alongPath(path, ore.progress);
				draw(ore, goal, heading);
			}
		}
		for (const [cell, ore] of this.held) {
			const model = this.models.get(cell);
			if (model) draw(ore, model.GetPivot().Position.add(new Vector3(0, HELD_HEIGHT, 0)), ore.heading);
		}
		const now = os.clock();
		this.swallowed = this.swallowed.filter(({ ore, into, gone }) => {
			if (now < gone) draw(ore, into, ore.heading);
			else ore.part.Destroy();
			return now < gone;
		});
		if (!parts.isEmpty()) Workspace.BulkMoveTo(parts, frames, Enum.BulkMoveMode.FireCFrameChanged);
	}
}
