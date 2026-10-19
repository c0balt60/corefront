import { OnStart, Service } from "@flamework/core";

import { BaseService, type Building, powerNetwork } from "game/Base/server/BaseService";
import { setPower } from "game/Base/server/models";
import { BUILDINGS, isPowered } from "game/Base/shared/buildings";
import { RESOURCE_ORDER } from "game/Base/shared/resources";

/** Seconds between power ticks. */
const POWER_SECONDS = 0.25;

/**
 * Runs the power networks, Mindustry style: each is everything linked together through power nodes
 * (see `powerNetwork`). Every tick its generators make power, burning fuel if they need it, wanted
 * or not. Whatever is at work wants its `power`. When the generators make enough, everything gets
 * all it wants and what's spare charges the batteries; when they don't, the batteries make up what
 * they can, and everything gets the same share of what there is.
 */
@Service()
export class PowerService implements OnStart {
	constructor(private readonly baseService: BaseService) {}

	onStart() {
		task.spawn(() => {
			while (true) {
				task.wait(POWER_SECONDS);
				if (this.baseService.phase() === "active") this.tick();
			}
		});
	}

	private tick() {
		const done = new Set<Building>();
		for (const building of this.baseService.buildings) {
			if (done.has(building) || !isPowered(building.kind)) continue;
			const network = powerNetwork(building);
			for (const member of network) done.add(member);
			this.balance(network);
		}
	}

	/** Shares out one network's power for this tick. Its nodes show its totals. */
	private balance(network: ReadonlySet<Building>) {
		let made = 0;
		let demand = 0;
		let stored = 0;
		let capacity = 0;
		for (const building of network) {
			const def = BUILDINGS[building.kind];
			made += this.generate(building);
			if (def.power !== undefined && this.working(building)) demand += def.power;
			if (def.battery !== undefined) {
				stored += building.charge;
				capacity += def.battery;
			}
		}
		const supply = made * POWER_SECONDS;
		const need = demand * POWER_SECONDS;
		// Taken from the batteries for a shortfall, or (negative) put into them from what's spare, as far as they hold.
		const drawn = math.clamp(need - supply, stored - capacity, stored);
		const charge = stored - drawn;
		const share = need > 0 ? math.min((supply + drawn) / need, 1) : supply + stored > 0 ? 1 : 0;
		// Rounded, so it's only written when it changes enough to see.
		const power = math.round(share * 100) / 100;

		for (const building of network) {
			const def = BUILDINGS[building.kind];
			if (def.battery !== undefined) {
				// Every battery on the network evenly full.
				building.charge = capacity > 0 ? (charge * def.battery) / capacity : 0;
				building.model.SetAttribute("Charge", math.floor(building.charge));
			}
			if (def.power !== undefined && building.power !== power) {
				building.power = power;
				setPower(building.model, power);
			}
			if (def.node !== undefined) {
				building.model.SetAttribute("Produced", math.round(made));
				building.model.SetAttribute("Demand", math.round(demand));
				building.model.SetAttribute("Stored", math.floor(charge));
			}
		}
	}

	/** The power a generator makes per second this tick, burning its next fuel when the last is spent. 0 for anything else. */
	private generate(building: Building): number {
		const generator = BUILDINGS[building.kind].generator;
		if (!generator) return 0;
		const fuel = generator.fuel;
		let made = generator.power;
		if (fuel) {
			if (building.burn <= 0) {
				const burning = RESOURCE_ORDER.find(
					(resource) => fuel[resource] !== undefined && (building.input[resource] ?? 0) > 0,
				);
				if (burning !== undefined) {
					this.baseService.hold(building, burning, building.input[burning]! - 1);
					building.burn = generator.seconds ?? POWER_SECONDS;
					building.efficiency = fuel[burning]!;
				}
			}
			made = building.burn > 0 ? generator.power * building.efficiency : 0;
			building.burn = math.max(building.burn - POWER_SECONDS, 0);
		}
		building.model.SetAttribute("PowerOut", math.round(made));
		return made;
	}

	/**
	 * Whether something that uses power is at work, so wants it: a turret with a target, a drill with
	 * room, a crafter with its inputs in and room for what it makes, and a mender always.
	 */
	private working(building: Building): boolean {
		const def = BUILDINGS[building.kind];
		if (def.turret) return building.engaged;
		if (def.drill) return building.stored < def.drill.storage;
		const craft = def.craft;
		if (craft) {
			const stocked = craft.inputs.every(({ resource, amount }) => (building.input[resource] ?? 0) >= amount);
			return stocked && building.stored < craft.storage;
		}
		return true;
	}
}
