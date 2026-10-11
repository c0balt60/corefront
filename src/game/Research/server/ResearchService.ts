import { OnStart, Service } from "@flamework/core";
import { subscribe } from "@rbxts/charm";
import type { Logger } from "@rbxts/log";
import { Players } from "@rbxts/services";
import { t } from "@rbxts/t";

import { BaseService } from "game/Base/server/BaseService";
import { RESOURCE_ORDER } from "game/Base/shared/resources";
import { PlanetsService } from "game/Planets/server/PlanetsService";
import { discoveredAtom, levelsOf, personal, statOf, teamAtom } from "game/Research/server/research-store";
import {
	isTeamNode,
	levelCost,
	lockReason,
	RESEARCH,
	RESEARCH_ORDER,
	type ResearchId,
} from "game/Research/shared/research";
import { ResearchMessage, researchMessaging } from "game/Research/shared/research-network";

const isResearchData = t.interface({ id: t.string });

/**
 * Research: each player levels up their own tree, paying from the team's Core
 * pool, and nodes on team stats (the Core's) level up for everyone. Also
 * notes which resources the Core has held, which some nodes wait on, and keeps
 * each character's walk speed up to date. The stats themselves are read
 * through `research-store` where they apply.
 */
@Service()
export class ResearchService implements OnStart {
	constructor(
		private readonly logger: Logger,
		private readonly baseService: BaseService,
		private readonly planetsService: PlanetsService,
	) {}

	onStart() {
		researchMessaging.server.on(ResearchMessage.Request, (player) => this.send(player));
		researchMessaging.server.on(ResearchMessage.Research, (player, data) => this.research(player, data));

		subscribe(this.baseService.poolAtom, (pool) => {
			const discovered = discoveredAtom();
			const found = RESOURCE_ORDER.filter(
				(resource) => (pool[resource] ?? 0) > 0 && !discovered.includes(resource),
			);
			if (!found.isEmpty()) discoveredAtom([...discovered, ...found]);
		});
		subscribe(discoveredAtom, () => Players.GetPlayers().forEach((player) => this.send(player)));

		const watch = (player: Player) =>
			player.CharacterAdded.Connect((character) => {
				(character.WaitForChild("Humanoid") as Humanoid).WalkSpeed = statOf(player.UserId, "walkSpeed");
			});
		Players.GetPlayers().forEach(watch);
		Players.PlayerAdded.Connect(watch);
	}

	private research(player: Player, data: unknown) {
		if (!isResearchData(data) || RESEARCH[data.id as ResearchId] === undefined) return;
		const id = data.id as ResearchId;
		const refuse = (text: string) => this.baseService.notify(player, text);
		if (this.baseService.phase() !== "active") return refuse("You can't research right now.");

		const levels = levelsOf(player.UserId);
		const reason = lockReason(id, levels, {
			conquered: this.planetsService.getConquered().size(),
			discovered: discoveredAtom(),
		});
		if (reason !== undefined) return refuse(`${reason}.`);
		const level = levels[id] ?? 0;
		const cost = levelCost(id, level);
		if (!this.baseService.canSpend(cost)) return refuse("The Core can't afford that.");

		this.baseService.spend(cost);
		this.logger.Info("{Player} researched {Node} to level {Level}", player.Name, id, level + 1);
		if (isTeamNode(id)) {
			teamAtom((team) => ({ ...team, [id]: level + 1 }));
			this.baseService.refreshCore();
			Players.GetPlayers().forEach((other) => this.send(other));
			return;
		}

		personal.set(player.UserId, { ...personal.get(player.UserId), [id]: level + 1 });
		this.send(player);
		const stat = RESEARCH[id].effect?.stat;
		if (stat === "carryCapacity") this.baseService.sendInventory(player);
		const humanoid = player.Character?.FindFirstChildOfClass("Humanoid");
		if (stat === "walkSpeed" && humanoid) humanoid.WalkSpeed = statOf(player.UserId, "walkSpeed");
	}

	private send(player: Player) {
		const levels = levelsOf(player.UserId);
		researchMessaging.client.emit(player, ResearchMessage.State, {
			levels: RESEARCH_ORDER.filter((id) => (levels[id] ?? 0) > 0).map((id) => ({ id, level: levels[id]! })),
			discovered: discoveredAtom(),
		});
	}
}
