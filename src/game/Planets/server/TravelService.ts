import { OnStart, Service } from "@flamework/core";
import type { Logger } from "@rbxts/log";
import { Players } from "@rbxts/services";
import { t } from "@rbxts/t";

import { BaseService } from "game/Base/server/BaseService";
import { RESOURCES, type ResourceStack, travelCost } from "game/Base/shared/resources";
import { PlanetsService } from "game/Planets/server/PlanetsService";
import {
	LAND_SECONDS,
	LAUNCH_SECONDS,
	PlanetsMessage,
	planetsMessaging,
	retreatTarget,
} from "game/Planets/shared/planets-network";

const isProposeData = t.interface({
	planet: t.integer,
	cargo: t.array(t.interface({ resource: t.keyOf(RESOURCES), amount: t.integer })),
});

/**
 * Moving the team between planets. Anyone on a liberated planet can set up a
 * launch to another unlocked planet: fuel (see `travelCost`) plus whatever cargo
 * they load. On a planet enemies still hold, the only way off is a retreat to the
 * nearest liberated planet (or the first), which destroys the Core and the base.
 * Either way, it goes once every deployed player has readied up. Losing the Core
 * retreats the team the same way, at once.
 */
@Service()
export class TravelService implements OnStart {
	constructor(
		private readonly logger: Logger,
		private readonly baseService: BaseService,
		private readonly planetsService: PlanetsService,
	) {}

	onStart() {
		planetsMessaging.server.on(PlanetsMessage.Propose, (player, data) => this.propose(player, data));
		planetsMessaging.server.on(PlanetsMessage.Ready, (player) => {
			const plan = this.planetsService.planAtom();
			if (!plan || !this.planetsService.isDeployed(player) || plan.ready.includes(player.UserId)) return;
			this.planetsService.planAtom({ ...plan, ready: [...plan.ready, player.UserId] });
			this.check();
		});
		planetsMessaging.server.on(PlanetsMessage.Cancel, (player) => {
			if (!this.planetsService.planAtom() || !this.planetsService.isDeployed(player)) return;
			this.planetsService.planAtom(undefined);
			for (const other of Players.GetPlayers())
				this.baseService.notify(other, `${player.Name} called off the launch.`);
		});
		// Whoever leaves no longer holds the launch up.
		Players.PlayerRemoving.Connect(() => task.defer(() => this.check()));
	}

	/** Sends the team to the nearest liberated planet (or the first) with nothing. The base here is lost. */
	retreat() {
		const from = this.planetsService.activeAtom();
		if (from === undefined || this.planetsService.travelAtom()) return;
		this.planetsService.planAtom(undefined);
		this.go(from, this.fallback(from));
	}

	private fallback(from: number): number {
		const { planetsService } = this;
		return retreatTarget(planetsService.getConquered(), from, planetsService.getPlanets().size());
	}

	private propose(player: Player, data: unknown) {
		const refuse = (text: string) => this.baseService.notify(player, text);
		const from = this.planetsService.activeAtom();
		if (!isProposeData(data) || from === undefined || !this.planetsService.isDeployed(player)) return;
		if (this.baseService.phase() !== "active") return refuse("You can't launch right now.");
		if (this.planetsService.planAtom()) return refuse("A launch is already set up.");

		if (!this.planetsService.isConquered(from)) {
			const planet = this.fallback(from);
			if (planet === from) return refuse("There's nowhere to retreat to.");
			this.planetsService.planAtom({ planet, cargo: [], abandon: true, ready: [player.UserId] });
			return this.check();
		}

		const planet = data.planet;
		if (planet === from || !this.planetsService.isUnlocked(planet)) return refuse("You can't launch there.");
		if (data.cargo.some(({ amount }) => amount < 1)) return;
		const fuel = travelCost(this.planetsService.getPlanets(), planet);
		if (!this.baseService.canSpend([...fuel, ...data.cargo]))
			return refuse("The Core doesn't hold enough for that.");
		this.planetsService.planAtom({ planet, cargo: data.cargo, abandon: false, ready: [player.UserId] });
		this.check();
	}

	/** Launches the plan once everyone on the planet is ready. */
	private check() {
		const plan = this.planetsService.planAtom();
		const from = this.planetsService.activeAtom();
		if (!plan || from === undefined) return;
		if (!this.planetsService.getDeployedIds().every((id) => plan.ready.includes(id))) return;
		this.planetsService.planAtom(undefined);

		if (plan.abandon) return this.go(from, plan.planet);
		// The pool may have changed since it was set up.
		const fuel = travelCost(this.planetsService.getPlanets(), plan.planet);
		const bill = [...fuel, ...plan.cargo];
		if (this.baseService.phase() !== "active" || !this.baseService.canSpend(bill)) {
			for (const player of Players.GetPlayers()) this.baseService.notify(player, "The launch was called off.");
			return;
		}
		this.baseService.spend(bill);
		this.go(from, plan.planet, plan.cargo);
	}

	/**
	 * Lifts off with `cargo`, or, without, retreats (the Core is lost, so nothing
	 * lifts off and nothing lands with it). Keeps the base here if the planet is
	 * liberated, activates the destination and lands the core on it once generated.
	 */
	private go(from: number, to: number, cargo?: ReadonlyArray<ResourceStack>) {
		const { planetsService } = this;
		const launch = cargo !== undefined;
		this.logger.Info("Travelling from planet {From} to {To}", from, to);
		planetsService.travelAtom({ from, to, stage: launch ? "launch" : "transit" });

		task.spawn(() => {
			if (launch) task.wait(LAUNCH_SECONDS);
			if (planetsService.isConquered(from)) this.baseService.save(from);
			if (cargo) this.baseService.expect(to, cargo);
			planetsService.travelAtom({ from, to, stage: "transit" });
			planetsService.activate(to);

			// Waits first: retreating to the planet it's on, the old map lingers until the deferred generate drops it.
			// ponytail: polls for the map, like PlanetsService.spawn.
			do task.wait(0.25);
			while (!planetsService.currentMap());
			planetsService.travelAtom({ from, to, stage: "land" });
			task.wait(LAND_SECONDS);
			planetsService.travelAtom(undefined);
		});
	}
}
