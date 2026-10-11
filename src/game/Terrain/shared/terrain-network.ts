import { MessageEmitter } from "@rbxts/tether";

/** The terrain debug panel (F4). Only trusted players get answers. Ids start at 120. */
export const terrainMessaging = MessageEmitter.create<TerrainMessageData>();

export const enum TerrainMessage {
	DebugRequest = 120,
	DebugState,
	DebugApply,
}

export interface TerrainDebugState {
	/** The applied config, as JSON (see `TERRAIN_FIELDS` in config.ts). */
	readonly config: string;
	readonly planet: number;
	readonly epoch: number;
	readonly generating: boolean;
	readonly loadedChunks: number;
	readonly totalChunks: number;
	/** Average milliseconds per chunk: noise and voxel building (parallel), and the terrain write (serial). */
	readonly buildMs: number;
	readonly writeMs: number;
	/** Wall-clock seconds the last full generation took, or 0 while the first is running. */
	readonly seconds: number;
}

export interface TerrainMessageData {
	/** Client -> server: I opened the panel, send me the state (ignored unless trusted). */
	[TerrainMessage.DebugRequest]: undefined;
	/** Server -> trusted clients: on request, on every apply, and as generation progresses. */
	[TerrainMessage.DebugState]: TerrainDebugState;
	/** Client -> server: regenerate the active planet with this config (JSON). The server sanitizes it. */
	[TerrainMessage.DebugApply]: { readonly config: string };
}
