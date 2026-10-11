import { MessageEmitter } from "@rbxts/tether";

import type { PlanetKind } from "core/Worlds/shared/star-system";
import type { WorldSummary } from "core/Worlds/shared/worlds";

/**
 * Creating, listing and joining worlds. Every Tether emitter shares one remote,
 * so place message ids start at 100 to stay clear of core's `Message` ids.
 */
export const serversMessaging = MessageEmitter.create<ServersMessageData>();

export const enum ServersMessage {
	Create = 100,
	Join,
	RequestList,
	List,
	Failed,
}

export interface ServersMessageData {
	/** Client -> server: reserve a world with these settings and teleport there. A `sandbox` is one planet of that kind. */
	[ServersMessage.Create]: { readonly seed: number; readonly isPrivate: boolean; readonly sandbox?: PlanetKind };
	/** Client -> server: join a world by its code, public or private. */
	[ServersMessage.Join]: { readonly code: string };
	/** Client -> server: send the public world list. */
	[ServersMessage.RequestList]: undefined;
	/** Server -> client: public worlds with room. */
	[ServersMessage.List]: { readonly worlds: Array<WorldSummary> };
	/** Server -> client: a create or join did not end in a teleport. Success needs no message: the player leaves. */
	[ServersMessage.Failed]: { readonly reason: string };
}
