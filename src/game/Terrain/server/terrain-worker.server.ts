import { ServerStorage, Workspace } from "@rbxts/services";

import { type Placement, placeAssets } from "game/Terrain/shared/assets";
import { buildChunk, VOXEL } from "game/Terrain/shared/chunk-builder";
import type { TerrainConfig } from "game/Terrain/shared/config";
import { CHUNK_STUDS } from "game/Terrain/shared/map";
import { newSampler, type Sampler } from "game/Terrain/shared/sampler";

/*
 * Parallel chunk worker. TerrainService clones this script into Actors; the
 * template copy in ServerScriptService.server.Terrain has no Actor and does
 * nothing. It may only import ReplicatedStorage modules (shared code and
 * packages): those requires are absolute, so they still resolve from a clone.
 *
 * Noise and voxels are built in the parallel phase. The terrain write and the
 * model clones happen after task.synchronize(), and only if the epoch hasn't
 * moved on, so a regenerate never gets stale chunks written over it.
 */

/** One chunk to build, as TerrainService sends it. */
interface Job {
	readonly id: number;
	readonly epoch: number;
	readonly cx: number;
	readonly cz: number;
	readonly config: TerrainConfig;
}

const actor = script.GetActor();
if (actor) {
	const runtime = ServerStorage.WaitForChild("TerrainRuntime");
	const done = runtime.WaitForChild("ChunkDone") as BindableEvent;
	const templates = runtime.WaitForChild("Templates");
	const props = Workspace.WaitForChild("PlanetProps");

	let sampler: Sampler | undefined;
	let samplerEpoch = -1;

	const place = (placement: Placement, folder: Folder) => {
		const template = templates.FindFirstChild(placement.name);
		if (!template || !template.IsA("Model")) return; // createTemplates already warned about it.
		const model = template.Clone();
		if (placement.scale !== 1) model.ScaleTo(placement.scale);
		model.PivotTo(new CFrame(placement.x, placement.y, placement.z).mul(CFrame.Angles(0, placement.yaw, 0)));
		if (placement.resource !== undefined) {
			model.AddTag("Ore");
			model.SetAttribute("Resource", placement.resource);
			model.SetAttribute("Cell", placement.cell);
		}
		model.Parent = folder;
	};

	actor.BindToMessageParallel("Build", (job: Job) => {
		const current = sampler && samplerEpoch === job.epoch ? sampler : newSampler(job.config);
		sampler = current;
		samplerEpoch = job.epoch;

		const buildStart = os.clock();
		const chunk = buildChunk(current, job.cx, job.cz);
		const placements = placeAssets(current, job.cx, job.cz);
		const buildTime = os.clock() - buildStart;

		task.synchronize();

		if (runtime.GetAttribute("Epoch") !== job.epoch) {
			done.Fire(job.id, false, buildTime, 0);
			return;
		}

		const writeStart = os.clock();
		const min = new Vector3(chunk.minX, chunk.minY, chunk.minZ);
		const region = new Region3(min, min.add(new Vector3(CHUNK_STUDS, chunk.sizeY, CHUNK_STUDS)));
		// The typings describe one voxel; the engine takes [x][y][z] arrays of them.
		const channels = {
			SolidMaterial: chunk.materials,
			SolidOccupancy: chunk.occupancy,
			LiquidOccupancy: chunk.liquid,
		} as unknown as VoxelChannels;
		Workspace.Terrain.WriteVoxelChannels(region, VOXEL, channels);

		if (placements.size() > 0) {
			const folder = new Instance("Folder");
			folder.Name = `${job.cx},${job.cz}`;
			for (const placement of placements) place(placement, folder);
			folder.Parent = props;
		}

		done.Fire(job.id, true, buildTime, os.clock() - writeStart);
	});

	// Messages sent before the handler is bound could be lost, so TerrainService waits for this.
	actor.SetAttribute("Ready", true);
}
