import { atom } from "@rbxts/charm";

import type { WorldSummary } from "core/Worlds/shared/worlds";

/** What the Create and Join pages are waiting on. The menu blocks input while busy and shows errors. */
export type ServersStatus =
	| { readonly kind: "idle" }
	| { readonly kind: "busy"; readonly text: string }
	| { readonly kind: "error"; readonly text: string };

/** The public worlds with room, as last sent by the server. */
export const worldsAtom = atom<ReadonlyArray<WorldSummary>>([]);

export const statusAtom = atom<ServersStatus>({ kind: "idle" });
