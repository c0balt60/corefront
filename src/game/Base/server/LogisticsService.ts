import { OnStart, Service } from "@flamework/core";
import { RunService } from "@rbxts/services";

import { BaseService, type Building, type Item } from "game/Base/server/BaseService";
import { BeltMessage, beltMessaging, type HeldItem, type ItemMove } from "game/Base/shared/base-network";
import { BELT_SPACING } from "game/Base/shared/belts";
import { BUILDINGS, isBelt } from "game/Base/shared/buildings";
import type { ResourceId } from "game/Base/shared/resources";

/** Seconds between ticks. Clients run the belts in between, so ore glides. */
const TICK = 0.1;
/** Seconds a router holds ore before passing it on. */
const ROUTER_SECONDS = 0.2;
/** The most sorters and junctions ore can pass straight through at once, so a ring of them can't loop forever. */
const MAX_HOPS = 8;
/** How far along a belt ore from a side can join it: never so near the back it holds up the main line. */
const MERGE_FROM = BELT_SPACING;
const MERGE_TO = 1 - BELT_SPACING;

/** Whether ore can join a belt `at` that far along without crowding any already on it. */
function clear(items: ReadonlyArray<Item>, at: number): boolean {
	return items.every((item) => math.abs(item.progress - at) >= BELT_SPACING - 1e-6);
}

/**
 * Where ore from a side can join a belt: in the gap nearest the middle that's wide enough, or
 * undefined while none is. The main line goes first; side ore merges into the room it leaves.
 */
function sideSlot(items: ReadonlyArray<Item>): number | undefined {
	// The best spot is the middle; failing that, the nearest the ore already there allows.
	const spots = [0.5, MERGE_FROM, MERGE_TO];
	for (const item of items) spots.push(item.progress - BELT_SPACING, item.progress + BELT_SPACING);
	let best: number | undefined;
	for (const at of spots) {
		const fits = at >= MERGE_FROM - 1e-6 && at <= MERGE_TO + 1e-6 && clear(items, at);
		if (fits && (best === undefined || math.abs(at - 0.5) < math.abs(best - 0.5))) best = at;
	}
	return best;
}

/**
 * Moves ore between buildings, Mindustry-style: drills, crafters and sources hand what they make to their
 * neighbours, belts carry it the way they face, routers pass it round, sorters split it and
 * junctions let it cross, until something takes it in for good (see `BaseService.receive`): the
 * Core, a turret's ammo or a crafter's inputs. Clients hear every move and animate it.
 */
@Service()
export class LogisticsService implements OnStart {
	/** This tick's moves, sent together. */
	private moves = new Array<ItemMove>();
	private elapsed = 0;

	constructor(private readonly baseService: BaseService) {}

	onStart() {
		beltMessaging.server.on(BeltMessage.Request, (player) =>
			beltMessaging.client.emit(player, BeltMessage.Contents, { items: this.contents() }),
		);
		RunService.Heartbeat.Connect((dt) => {
			if (this.baseService.phase() !== "active") return;
			// Never more than a few ticks to catch up on after a stall.
			this.elapsed = math.min(this.elapsed + dt, TICK * 3);
			while (this.elapsed >= TICK) {
				this.elapsed -= TICK;
				this.tick();
			}
			if (this.moves.isEmpty()) return;
			beltMessaging.client.emitAll(BeltMessage.Moves, { moves: this.moves });
			this.moves = [];
		});
	}

	private tick() {
		for (const building of this.baseService.buildings) {
			if (isBelt(building.kind)) this.carry(building);
			else if (building.kind === "router") this.route(building);
			else if (building.kind === "source") {
				if (building.filter !== undefined) this.offload(building, building.filter);
			} else if (building.resource !== undefined && building.stored > 0)
				this.offload(building, building.resource);
		}
	}

	/** Moves a belt's ore along, each stopping short of the one ahead, and hands the front one on. */
	private carry(belt: Building) {
		const items = belt.items;
		const step = BUILDINGS[belt.kind].belt! * TICK;
		for (let i = items.size() - 1; i >= 0; i--) {
			const item = items[i];
			const limit = i === items.size() - 1 ? 1 : items[i + 1].progress - BELT_SPACING;
			item.progress = math.max(item.progress, math.min(item.progress + step, limit));
		}
		const front = items[items.size() - 1];
		if (front === undefined || front.progress < 1) return;
		const onward = this.baseService.neighbour(belt.cell, belt.rotation);
		if (onward && this.offer(onward, front.resource, belt, belt.rotation, belt.cell)) items.pop();
	}

	/** Passes a router's ore to the next neighbour round that takes it, but never straight back. */
	private route(router: Building) {
		const item = router.items[0];
		if (item === undefined) return;
		item.progress += TICK;
		if (item.progress < ROUTER_SECONDS) return;
		for (let i = 0; i < 4; i++) {
			const side = (router.turn + i) % 4;
			const onward = this.baseService.neighbour(router.cell, side);
			if (!onward || onward === item.from || !this.offer(onward, item.resource, router, side, router.cell))
				continue;
			router.items.pop();
			router.turn = (side + 1) % 4;
			return;
		}
	}

	/** Hands one of what a drill or crafter made, or a Source's ore, to the next neighbour round that takes it. */
	private offload(source: Building, resource: ResourceId) {
		const around = this.baseService.around(source);
		for (let i = 0; i < around.size(); i++) {
			const index = (source.turn + i) % around.size();
			const [onward, side] = around[index];
			if (!this.offer(onward, resource, source, side, source.cell)) continue;
			// A Source never runs out.
			if (source.kind !== "source") {
				source.stored--;
				source.model.SetAttribute("Stored", source.stored);
			}
			source.turn = index + 1;
			return;
		}
	}

	/**
	 * Offers `resource`, heading `side` out of `from`, to `target`. Sorters and junctions pass it
	 * straight on. True if something took it, and clients hear it went there from the building on `origin`.
	 */
	private offer(
		target: Building,
		resource: ResourceId,
		from: Building,
		side: number,
		origin: number,
		hops = 0,
	): boolean {
		// The side of `target` it comes in by.
		const face = (side + 2) % 4;
		let joined = 0;
		if (isBelt(target.kind)) {
			// Ore joins at the back of the belt's path, or from a side into a gap near the middle. Never by its front.
			if (face === target.rotation) return false;
			const at = face === target.entry ? (clear(target.items, 0) ? 0 : undefined) : sideSlot(target.items);
			if (at === undefined) return false;
			joined = at;
			const index = target.items.findIndex((item) => item.progress > at);
			const item = { resource, progress: at };
			if (index < 0) target.items.push(item);
			else target.items.insert(index, item);
		} else if (target.kind === "router") {
			if (!target.items.isEmpty()) return false;
			target.items.push({ resource, progress: 0, from });
		} else if (target.kind === "junction" || target.kind === "sorter") {
			if (hops >= MAX_HOPS) return false;
			// A junction or a matching sorter sends it straight on; a sorter turns the rest aside, alternating sides.
			const straight = target.kind === "junction" || resource === target.filter;
			const outs = straight ? [side] : [(side + 1 + 2 * target.turn) % 4, (side + 3 + 2 * target.turn) % 4];
			for (const out of outs) {
				const onward = this.baseService.neighbour(target.cell, out);
				if (!onward || !this.offer(onward, resource, target, out, origin, hops + 1)) continue;
				if (!straight) target.turn = 1 - target.turn;
				return true;
			}
			return false;
		} else if (!this.baseService.receive(target, resource)) {
			return false;
		}
		this.moves.push({ from: origin, to: target.cell, resource, at: joined });
		return true;
	}

	/** Everything on the belts and in the routers, for a client that just joined. */
	private contents(): Array<HeldItem> {
		const items = new Array<HeldItem>();
		for (const building of this.baseService.buildings) {
			for (const { resource, progress } of building.items)
				items.push({ cell: building.cell, resource, progress });
		}
		return items;
	}
}
