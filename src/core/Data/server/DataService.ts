import { OnStart, Service } from "@flamework/core";
import { atom, computed, subscribe } from "@rbxts/charm";
import type { Logger } from "@rbxts/log";
import ProfileStore, { type Profile } from "@rbxts/profile-store";
import { Players } from "@rbxts/services";
import Sift from "@rbxts/sift";

import { DEFAULT_PLAYER_DATA, type PlayerData } from "core/Data/shared/player-data";
import { IS_STUDIO } from "core/shared/constants";

/** Bump the suffix to start everybody over on a clean store. */
const STORE_NAME = "PlayerData_v1";

/** Studio uses a throwaway mock store, so playtests never touch live data. */
const USE_MOCK_STORE = IS_STUDIO;

/**
 * Loads, holds and saves every player's profile.
 *
 * The Charm atom is the only copy the game reads and writes; `Profile.Data`
 * is refreshed from it just before each save. Always change data through
 * {@link DataService.update} and return a new table, never mutate.
 */
@Service({ loadOrder: 0 })
export class DataService implements OnStart {
	private readonly dataAtom = atom<Readonly<Record<string, PlayerData>>>({});
	private readonly profiles = new Map<Player, Profile<PlayerData>>();
	private readonly selectors = new Map<Player, () => PlayerData | undefined>();
	private readonly store = USE_MOCK_STORE
		? ProfileStore.New(STORE_NAME, DEFAULT_PLAYER_DATA).Mock
		: ProfileStore.New(STORE_NAME, DEFAULT_PLAYER_DATA);

	constructor(private readonly logger: Logger) {}

	onStart() {
		const load = (player: Player) =>
			this.load(player).catch((err) => {
				this.logger.Error("Could not load data for {Player}: {Error}", player.Name, err);
				player.Kick("Your data could not be loaded. Please rejoin.");
			});

		Players.GetPlayers().forEach(load);
		Players.PlayerAdded.Connect(load);
		// Ending the session saves one last time; `OnSessionEnd` then forgets the player.
		Players.PlayerRemoving.Connect((player) => this.profiles.get(player)?.EndSession());
	}

	/** A player's data, or `undefined` before it has loaded. */
	getData(player: Player): PlayerData | undefined {
		return this.dataAtom()[tostring(player.UserId)];
	}

	/** A Charm getter for one player's data, for anything that reacts to it changing. */
	selectData(player: Player): () => PlayerData | undefined {
		let selector = this.selectors.get(player);
		if (!selector) {
			const key = tostring(player.UserId);
			selector = computed(() => this.dataAtom()[key]);
			this.selectors.set(player, selector);
		}
		return selector;
	}

	/** Resolves with a player's data once it has loaded, or `undefined` if they leave first. */
	waitForData(player: Player): Promise<PlayerData | undefined> {
		const key = tostring(player.UserId);
		const read = () => this.dataAtom()[key];
		const loaded = read();
		if (loaded) return Promise.resolve(loaded);

		return new Promise((resolve) => {
			const cleanups = new Array<() => void>();
			const done = (data: PlayerData | undefined) => {
				cleanups.forEach((cleanup) => cleanup());
				resolve(data);
			};

			cleanups.push(
				subscribe(read, (data) => {
					if (data) done(data);
				}),
			);
			const leaving = Players.PlayerRemoving.Connect((left) => {
				if (left === player) done(undefined);
			});
			cleanups.push(() => leaving.Disconnect());
		});
	}

	/**
	 * Rewrites a player's data. Does nothing if their session is not active.
	 *
	 * @param updater - Returns the new data. Must return a new table, not edit the old one.
	 * @returns The new data, or `undefined` if nothing was written.
	 */
	update(player: Player, updater: (data: PlayerData) => PlayerData): PlayerData | undefined {
		const current = this.getData(player);
		if (!current || !this.profiles.get(player)?.IsActive()) return undefined;

		const updated = updater(current);
		this.dataAtom((state) => Sift.Dictionary.set(state, tostring(player.UserId), updated));
		return updated;
	}

	private async load(player: Player) {
		const profile = this.store.StartSessionAsync(`Player_${player.UserId}`, {
			Cancel: () => player.Parent !== Players,
		});

		if (!profile) {
			player.Kick("Your data could not be loaded. Please rejoin.");
			return;
		}

		if (player.Parent !== Players) {
			// They left while the session was starting.
			profile.EndSession();
			return;
		}

		// Ties the key to the player for GDPR erasure requests.
		profile.AddUserId(player.UserId);
		profile.Reconcile();

		const key = tostring(player.UserId);

		profile.OnSave.Connect(() => {
			const data = this.dataAtom()[key];
			// Charm freezes its state in Studio and ProfileStore edits what it saves, so hand it a copy.
			if (data) profile.Data = Sift.Dictionary.copyDeep(data);
		});

		profile.OnSessionEnd.Connect(() => {
			this.profiles.delete(player);
			this.selectors.delete(player);
			this.dataAtom((state) => Sift.Dictionary.removeKey(state, key));
			if (player.Parent === Players) player.Kick("Your data was opened on another server. Please rejoin.");
		});

		this.profiles.set(player, profile);
		this.dataAtom((state) => Sift.Dictionary.set(state, key, Sift.Dictionary.copyDeep(profile.Data)));
		this.logger.Info("Loaded data for {Player}", player.Name);
	}
}
