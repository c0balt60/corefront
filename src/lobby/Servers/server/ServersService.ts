import { OnStart, Service } from "@flamework/core";
import type { Logger } from "@rbxts/log";
import { TeleportService } from "@rbxts/services";

import { IS_STUDIO } from "core/shared/constants";
import { teleport } from "core/Teleport/server/teleport";
import { PLACE_IDS } from "core/Teleport/shared/places";
import type { WorldTeleportData } from "core/Teleport/shared/teleport-data";
import { getWorld, listPublicWorlds, putWorld, removeWorld } from "core/Worlds/server/registry";
import {
	CODE_ALPHABET,
	CODE_LENGTH,
	isValidCode,
	isValidSeed,
	MAX_PLAYERS,
	type WorldSummary,
} from "core/Worlds/shared/worlds";
import { LoadingService } from "lobby/Loading/server/LoadingService";
import { ServersMessage, serversMessaging } from "lobby/Servers/shared/servers-network";

/** Seconds one server-wide copy of the world list is reused, to stay inside MemoryStore limits. */
const LIST_CACHE_TIME = 5;

/**
 * Creates worlds (a reserved game server registered under a join code) and
 * sends players into them. A player can have one create or join running at a
 * time. Anything that does not end in a teleport is reported with `Failed`.
 */
@Service()
export class ServersService implements OnStart {
	private readonly busy = new Set<Player>();
	private listCache: { readonly at: number; readonly worlds: Array<WorldSummary> } | undefined;

	constructor(
		private readonly logger: Logger,
		private readonly loadingService: LoadingService,
	) {}

	onStart() {
		serversMessaging.server.on(ServersMessage.Create, (player, data) => {
			this.run(player, () => this.create(player, data?.seed, data?.isPrivate));
		});
		serversMessaging.server.on(ServersMessage.Join, (player, data) => {
			this.run(player, () => this.join(player, data?.code));
		});
		serversMessaging.server.on(ServersMessage.RequestList, (player) => {
			task.spawn(() => serversMessaging.client.emit(player, ServersMessage.List, { worlds: this.list() }));
		});

		TeleportService.TeleportInitFailed.Connect((player, _result, message) => {
			serversMessaging.client.emit(player, ServersMessage.Failed, { reason: `Teleport failed: ${message}` });
		});
	}

	/** Runs a create or join off the network thread, and reports its error, if any. */
	private run(player: Player, work: () => string | undefined) {
		if (this.busy.has(player) || !this.loadingService.isLoaded(player)) return;
		this.busy.add(player);
		task.spawn(() => {
			const [ok, result] = pcall(work);
			this.busy.delete(player);
			const reason = ok ? (result as string | undefined) : "Something went wrong. Try again.";
			if (!ok) this.logger.Error("Create/join for {Player} errored: {Error}", player.Name, result);
			if (reason !== undefined) serversMessaging.client.emit(player, ServersMessage.Failed, { reason });
		});
	}

	private create(player: Player, seed: unknown, isPrivate: unknown): string | undefined {
		if (!isValidSeed(seed) || !typeIs(isPrivate, "boolean")) return "Invalid world settings.";
		if (IS_STUDIO || PLACE_IDS.game === 0) {
			return "Worlds can't be created in Studio. Publish both places and set their ids in environments.ts.";
		}

		const [reserved, server] = pcall(() => {
			const [accessCode, privateServerId] = TeleportService.ReserveServer(PLACE_IDS.game);
			return { accessCode, privateServerId };
		});
		if (!reserved) {
			this.logger.Warn("ReserveServer failed: {Error}", server);
			return "Could not reserve a server. Try again.";
		}
		const { accessCode, privateServerId } = server;

		const code = this.newCode();
		if (code === undefined) return "Could not register the world. Try again.";
		const registered = putWorld({
			code,
			accessCode,
			privateServerId,
			seed,
			isPrivate,
			hostName: player.DisplayName,
			players: 0,
		});
		if (!registered) return "Could not register the world. Try again.";

		this.logger.Info(
			"{Player} created world {Code} (seed {Seed}, private {Private})",
			player.Name,
			code,
			seed,
			isPrivate,
		);
		if (this.send(player, accessCode, code)) return undefined;
		removeWorld(code);
		return "Teleport failed. Try again.";
	}

	private join(player: Player, input: unknown): string | undefined {
		const code = typeIs(input, "string") ? input.upper() : undefined;
		if (!isValidCode(code)) return "Enter a valid 6-character code.";
		if (IS_STUDIO || PLACE_IDS.game === 0) return "Worlds can't be joined in Studio.";

		const entry = getWorld(code);
		if (!entry) return "No world with that code. It may have closed.";
		if (entry.players >= MAX_PLAYERS) return "That world is full.";

		return this.send(player, entry.accessCode, code) ? undefined : "Teleport failed. Try again.";
	}

	private send(player: Player, accessCode: string, code: string): boolean {
		const options = new Instance("TeleportOptions");
		options.ReservedServerAccessCode = accessCode;
		options.SetTeleportData(identity<WorldTeleportData>({ code }));
		return teleport(PLACE_IDS.game, [player], options);
	}

	/** A join code not in use, or `undefined` if the registry can't be read. */
	private newCode(): string | undefined {
		const random = new Random();
		for (let attempt = 0; attempt < 5; attempt++) {
			let code = "";
			for (let i = 0; i < CODE_LENGTH; i++) {
				const index = random.NextInteger(1, CODE_ALPHABET.size());
				code += CODE_ALPHABET.sub(index, index);
			}
			if (getWorld(code) === undefined) return code;
		}
		return undefined;
	}

	private list(): Array<WorldSummary> {
		const now = os.clock();
		if (!this.listCache || now - this.listCache.at > LIST_CACHE_TIME) {
			this.listCache = { at: now, worlds: listPublicWorlds() };
		}
		return this.listCache.worlds;
	}
}
