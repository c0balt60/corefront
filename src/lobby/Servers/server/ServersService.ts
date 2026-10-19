import { OnStart, Service } from "@flamework/core";
import type { Logger } from "@rbxts/log";
import { TeleportService } from "@rbxts/services";

import { IS_STUDIO } from "core/shared/constants";
import { teleport } from "core/Teleport/server/teleport";
import { PLACE_IDS } from "core/Teleport/shared/places";
import type { WorldTeleportData } from "core/Teleport/shared/teleport-data";
import { getWorld, listPublicWorlds, putWorld, removeWorld } from "core/Worlds/server/registry";
import { deleteSave, listSaves, readSave, updateSave, type WorldSave } from "core/Worlds/server/saves";
import { isStarSettings, type StarSettings } from "core/Worlds/shared/star-system";
import {
	CODE_ALPHABET,
	CODE_LENGTH,
	isValidCode,
	isValidSlot,
	MAX_PLAYERS,
	type SaveRef,
	type WorldSummary,
} from "core/Worlds/shared/worlds";
import { LoadingService } from "lobby/Loading/server/LoadingService";
import { ServersMessage, serversMessaging } from "lobby/Servers/shared/servers-network";

/** Seconds one server-wide copy of the world list is reused, to stay inside MemoryStore limits. */
const LIST_CACHE_TIME = 5;

/**
 * Creates worlds (a reserved game server registered under a join code) and
 * sends players into them. Every world belongs to one of its creator's save
 * slots: creating fills an empty slot, loading carries a slot's world on.
 * A player can have one create, load, join or delete running at a time.
 * Anything that does not end in a teleport (or, for a delete, the new slots)
 * is reported with `Failed`.
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
			this.run(player, () => this.create(player, data?.slot, data?.settings, data?.isPrivate));
		});
		serversMessaging.server.on(ServersMessage.Load, (player, data) => {
			this.run(player, () => this.load(player, data?.slot));
		});
		serversMessaging.server.on(ServersMessage.Delete, (player, data) => {
			this.run(player, () => this.delete(player, data?.slot));
		});
		serversMessaging.server.on(ServersMessage.RequestSaves, (player) => {
			task.spawn(() => this.sendSaves(player));
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

	private create(player: Player, slot: unknown, settings: unknown, isPrivate: unknown): string | undefined {
		if (!isValidSlot(slot) || !isStarSettings(settings) || !typeIs(isPrivate, "boolean")) {
			return "Invalid world settings.";
		}
		if (IS_STUDIO || PLACE_IDS.game === 0) {
			return "Worlds can't be created in Studio. Publish both places and set their ids in environments.ts.";
		}

		// Only into an empty slot: a filled one has to be deleted first.
		return this.host(player, { owner: player.UserId, slot }, settings, isPrivate, (old, code) =>
			old ? undefined : { settings, isPrivate, code, savedAt: os.time(), conquered: 0 },
		);
	}

	private load(player: Player, slot: unknown): string | undefined {
		if (!isValidSlot(slot)) return "Invalid save slot.";
		if (IS_STUDIO || PLACE_IDS.game === 0) return "Worlds can't be loaded in Studio.";

		const ref = { owner: player.UserId, slot };
		const save = readSave(ref);
		if (save === false) return "Could not read your save. Try again.";
		if (!save) return "That slot is empty.";

		// Still running, maybe with friends in it: rejoin it rather than start a second copy.
		const running = getWorld(save.code);
		if (running && running.save.owner === ref.owner && running.save.slot === slot) {
			if (running.players >= MAX_PLAYERS) return "That world is full.";
			return this.send(player, running.accessCode, save.code) ? undefined : "Teleport failed. Try again.";
		}

		// Pointing the save at the new world locks out any older one still writing to it.
		return this.host(player, ref, save.settings, save.isPrivate, (old, code) => old && { ...old, code });
	}

	private delete(player: Player, slot: unknown): string | undefined {
		if (!isValidSlot(slot)) return "Invalid save slot.";
		if (!deleteSave({ owner: player.UserId, slot })) return "Could not delete that save. Try again.";
		this.logger.Info("{Player} deleted save slot {Slot}", player.Name, slot);
		this.sendSaves(player);
		return undefined;
	}

	private sendSaves(player: Player) {
		const saves = listSaves(player.UserId);
		if (saves) serversMessaging.client.emit(player, ServersMessage.Saves, { saves });
		else serversMessaging.client.emit(player, ServersMessage.Failed, { reason: "Could not load your saves." });
	}

	/**
	 * Reserves a server for the world in `ref`, points the save at it with `claim` (which gets what the slot
	 * holds and the new join code, and returns the save to write, or `undefined` to give up), registers it
	 * and sends the player there.
	 */
	private host(
		player: Player,
		ref: SaveRef,
		settings: StarSettings,
		isPrivate: boolean,
		claim: (old: WorldSave | undefined, code: string) => WorldSave | undefined,
	): string | undefined {
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
		if (!updateSave(ref, (old) => claim(old, code))) return "Could not save to that slot. Try again.";
		const registered = putWorld({
			...settings,
			code,
			accessCode,
			privateServerId,
			isPrivate,
			save: ref,
			hostName: player.DisplayName,
			players: 0,
		});
		if (!registered) return "Could not register the world. Try again.";

		this.logger.Info(
			"{Player} started world {Code} from slot {Slot} (seed {Seed}, private {Private}, sandbox {Sandbox})",
			player.Name,
			code,
			ref.slot,
			settings.seed,
			isPrivate,
			settings.sandbox,
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
