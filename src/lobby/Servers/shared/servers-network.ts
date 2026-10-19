import { MessageEmitter } from "@rbxts/tether";

import type { StarSettings } from "core/Worlds/shared/star-system";
import type { SaveSummary, WorldSummary } from "core/Worlds/shared/worlds";

/**
 * Save slots, and creating, listing and joining worlds. Every Tether emitter shares one remote,
 * so place message ids start at 100 to stay clear of core's `Message` ids.
 */
export const serversMessaging = MessageEmitter.create<ServersMessageData>();

export const enum ServersMessage {
	Create = 100,
	Join,
	RequestList,
	List,
	Failed,
	RequestSaves,
	Saves,
	Load,
	Delete,
}

export interface ServersMessageData {
	/** Client -> server: start a world with these settings in an empty slot, and teleport there. */
	[ServersMessage.Create]: { readonly slot: number; readonly settings: StarSettings; readonly isPrivate: boolean };
	/** Client -> server: join a world by its code, public or private. */
	[ServersMessage.Join]: { readonly code: string };
	/** Client -> server: send the public world list. */
	[ServersMessage.RequestList]: undefined;
	/** Server -> client: public worlds with room. */
	[ServersMessage.List]: { readonly worlds: Array<WorldSummary> };
	/** Server -> client: a create or join did not end in a teleport. Success needs no message: the player leaves. */
	[ServersMessage.Failed]: { readonly reason: string };
	/** Client -> server: send my save slots. */
	[ServersMessage.RequestSaves]: undefined;
	/** Server -> client: the filled slots. A slot missing from the list is empty. */
	[ServersMessage.Saves]: { readonly saves: Array<SaveSummary> };
	/** Client -> server: carry on the world in this slot: rejoin it if it's running, or start it up again. */
	[ServersMessage.Load]: { readonly slot: number };
	/** Client -> server: empty this slot. */
	[ServersMessage.Delete]: { readonly slot: number };
}
