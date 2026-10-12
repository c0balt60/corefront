import { OnStart, Service } from "@flamework/core";
import { atom } from "@rbxts/charm";
import type { Logger } from "@rbxts/log";
import {
	CollectionService,
	HttpService,
	Lighting,
	RunService,
	ServerScriptService,
	ServerStorage,
	Workspace,
} from "@rbxts/services";

import { generateStarSystem, type PlanetKind } from "core/Worlds/shared/star-system";
import { ArrivalService } from "game/Arrival/server/ArrivalService";
import type { ResourceId } from "game/Base/shared/resources";
import type { OreDeposit, PlanetMap } from "game/Terrain/server/planet-map";
import { createTemplates } from "game/Terrain/server/prop-templates";
import { configForPlanet, defaultConfig, type TerrainConfig } from "game/Terrain/shared/config";
import { CELL_STUDS, cellCoords, MAP_CHUNKS, MAP_HALF, MAP_STUDS } from "game/Terrain/shared/map";
import { newSampler, type Sampler, WORLD_BOTTOM, WORLD_TOP } from "game/Terrain/shared/sampler";
import type { TerrainDebugState } from "game/Terrain/shared/terrain-network";

const WORKER_COUNT = 8;
/** Seconds before a job that never reported (a worker error, say) is given up and its worker reused. */
const JOB_TIMEOUT = 15;
/** Tries per chunk before it is left empty, so one bad chunk can't stall a planet forever. */
const MAX_ATTEMPTS = 3;
const CHUNK_COUNT = MAP_CHUNKS * MAP_CHUNKS;
/**
 * Spacing of the baked ground heights: the voxel size. The heightmap is only
 * what the voxels were filled from; Roblox meshes them a stud or two off it,
 * so gameplay reads the ground back from the written terrain instead.
 */
const GROUND_STEP = 4;
const GROUND_POINTS = MAP_STUDS / GROUND_STEP + 1;
/** Rows of ground raycasts per frame while baking, so it never hitches the server. */
const BAKE_ROWS = 16;
/**
 * Chunks handed to workers a second, at most one a frame, so their terrain writes, and what
 * clients receive of them, are spread out: 256 chunks take at least ~8.5 seconds.
 */
const CHUNKS_PER_SECOND = 30;
/** The old planet's prop folders destroyed a frame, and the new one's props settled onto the ground a frame. */
const CLEAR_PER_FRAME = 8;
const SETTLE_PER_FRAME = 300;
/** The share of `progressAtom` the chunks make up, then the ground bake; settling the props is the rest. */
const CHUNK_SHARE = 0.85;
const BAKE_SHARE = 0.1;

/** Chunk indexes (`cz * MAP_CHUNKS + cx`), farthest from the centre first: popping the end takes the nearest. */
const CHUNK_ORDER = new Array<number>();
for (let chunk = 0; chunk < CHUNK_COUNT; chunk++) CHUNK_ORDER.push(chunk);
const fromCentre = (chunk: number) => {
	const dx = (chunk % MAP_CHUNKS) - (MAP_CHUNKS - 1) / 2;
	const dz = math.floor(chunk / MAP_CHUNKS) - (MAP_CHUNKS - 1) / 2;
	return dx * dx + dz * dz;
};
CHUNK_ORDER.sort((a, b) => fromCentre(a) > fromCentre(b));

/** A small per-kind tint: outdoor ambient, and the haze if the place has an Atmosphere. */
const SKIES: Record<PlanetKind, { readonly ambient: Color3; readonly haze: Color3 }> = {
	Habitable: { ambient: Color3.fromRGB(128, 128, 128), haze: Color3.fromRGB(199, 199, 199) },
	Barren: { ambient: Color3.fromRGB(140, 124, 108), haze: Color3.fromRGB(205, 175, 140) },
	Frozen: { ambient: Color3.fromRGB(128, 140, 162), haze: Color3.fromRGB(205, 225, 245) },
	Volcanic: { ambient: Color3.fromRGB(124, 84, 72), haze: Color3.fromRGB(190, 92, 60) },
};

interface Job {
	readonly chunk: number;
	readonly epoch: number;
	readonly actor: Actor;
	readonly startedAt: number;
}

/**
 * Generates the active planet's terrain on a finite 1024-stud map: 256 chunks
 * built by a pool of Actor workers (see terrain-worker.server.ts), nearest the
 * centre first, with no streaming. Every generation bumps the epoch, so stale
 * worker results are dropped and the latest call wins.
 *
 * Instances: `Workspace.PlanetProps` holds props and ore deposits, one Folder
 * per chunk named "cx,cz". `ServerStorage.TerrainRuntime` (server only) holds
 * the `ChunkDone` event, the `Templates` and the `Epoch` attribute, and
 * `ServerScriptService.TerrainWorkers` holds the Actors.
 */
@Service()
export class TerrainService implements OnStart {
	/** The generated active planet. `undefined` before the first generation and while one runs. */
	readonly mapAtom = atom<PlanetMap>();
	/** How much of the planet generating (or generated) is done, 0 to 1, for the players waiting on it. */
	readonly progressAtom = atom(0);

	private epoch = 0;
	private planet = 0;
	private config = defaultConfig();
	private configJson = HttpService.JSONEncode(this.config);
	private sampler?: Sampler;

	private readonly runtime = new Instance("Folder");
	private readonly done = new Instance("BindableEvent");
	private readonly props = new Instance("Folder");
	private readonly idle = new Array<Actor>();
	private readonly jobs = new Map<number, Job>();
	private nextJobId = 0;
	/** Builds up by `CHUNKS_PER_SECOND`; each chunk handed out spends one. */
	private credit = 0;
	/** Chunks of the current epoch still to dispatch, nearest last. */
	private queue = new Array<number>();
	private readonly attempts = new Map<number, number>();
	private remaining = CHUNK_COUNT;

	private startedAt = 0;
	private built = 0;
	private buildTotal = 0;
	private writeTotal = 0;
	private lastSeconds = 0;

	/** Progress and timings for the debug panel. */
	readonly statusAtom = atom(this.status(false));

	constructor(
		private readonly logger: Logger,
		private readonly arrivalService: ArrivalService,
	) {
		// Set up in the constructor, so a `generate` from another service's onStart already has somewhere to go.
		this.runtime.Name = "TerrainRuntime";
		this.done.Name = "ChunkDone";
		this.done.Parent = this.runtime;
		this.props.Name = "PlanetProps";
	}

	onStart() {
		createTemplates(this.runtime);
		this.runtime.Parent = ServerStorage;
		this.props.Parent = Workspace;
		this.done.Event.Connect((id: number, ok: boolean, buildTime: number, writeTime: number) =>
			this.finishJob(id, ok, buildTime, writeTime),
		);
		this.spawnWorkers();
		RunService.Heartbeat.Connect((dt) => this.pump(dt));

		task.spawn(() => {
			while (true) {
				task.wait(1);
				this.reap();
			}
		});
	}

	/** (Re)generates planet `index` of the world's star system, replacing whatever is there. */
	generate(index: number): void {
		const epoch = this.begin(index);
		task.spawn(() => {
			let world = this.arrivalService.getWorld();
			while (!world) {
				task.wait(0.2);
				world = this.arrivalService.getWorld();
			}
			if (epoch !== this.epoch) return;

			const planet = generateStarSystem(world.seed, world.sandbox).planets[index];
			if (!planet) {
				this.logger.Warn("World {Code} has no planet {Index}", world.code, index);
				return;
			}
			this.run(configForPlanet(planet));
		});
	}

	/** Regenerates the current planet (planet 0 before any) with `config`, for the debug panel. */
	regenerate(config: TerrainConfig): void {
		this.begin(this.planet);
		this.run(config);
	}

	/** The config of the latest generation. */
	getConfig(): TerrainConfig {
		return this.config;
	}

	/** Drops the current planet at once: anything still building for it is discarded. */
	private begin(index: number): number {
		this.epoch += 1;
		this.planet = index;
		this.runtime.SetAttribute("Epoch", this.epoch);
		this.mapAtom(undefined);
		this.progressAtom(0);
		this.queue = [];
		Workspace.Terrain.Clear();
		// A few chunks' props a frame, not thousands of models at once. Long gone before the new ones settle.
		const old = this.props.GetChildren();
		task.spawn(() => {
			for (let i = 0; i < old.size(); i++) {
				old[i].Destroy();
				if (i % CLEAR_PER_FRAME === CLEAR_PER_FRAME - 1) task.wait();
			}
		});
		return this.epoch;
	}

	private run(config: TerrainConfig) {
		this.config = config;
		this.configJson = HttpService.JSONEncode(config);
		this.sampler = newSampler(config);
		this.queue = [...CHUNK_ORDER];
		this.attempts.clear();
		this.remaining = CHUNK_COUNT;
		this.startedAt = os.clock();
		this.built = 0;
		this.buildTotal = 0;
		this.writeTotal = 0;

		const sky = SKIES[config.kind];
		Lighting.OutdoorAmbient = sky.ambient;
		const atmosphere = Lighting.FindFirstChildOfClass("Atmosphere");
		if (atmosphere) {
			atmosphere.Color = sky.haze;
			atmosphere.Decay = sky.haze.Lerp(new Color3(), 0.4);
		}

		this.statusAtom(this.status(true));
	}

	private spawnWorkers() {
		const template = script.Parent!.WaitForChild("terrain-worker");
		const folder = new Instance("Folder");
		folder.Name = "TerrainWorkers";
		for (let i = 1; i <= WORKER_COUNT; i++) {
			const actor = new Instance("Actor");
			actor.Name = `Worker${i}`;
			// The worker flags itself ready once its handler is bound.
			actor.GetAttributeChangedSignal("Ready").Once(() => this.idle.push(actor));
			template.Clone().Parent = actor;
			actor.Parent = folder;
		}
		folder.Parent = ServerScriptService;
	}

	/** Hands a queued chunk to an idle worker, each frame there's credit for one (see `CHUNKS_PER_SECOND`). */
	private pump(dt: number) {
		this.credit = math.min(this.credit + dt * CHUNKS_PER_SECOND, 1);
		if (this.credit >= 1 && this.idle.size() > 0 && this.queue.size() > 0) {
			this.credit -= 1;
			const chunk = this.queue.pop()!;
			const actor = this.idle.pop()!;
			this.nextJobId += 1;
			const id = this.nextJobId;
			this.jobs.set(id, { chunk, epoch: this.epoch, actor, startedAt: os.clock() });
			actor.SendMessage("Build", {
				id,
				epoch: this.epoch,
				cx: chunk % MAP_CHUNKS,
				cz: math.floor(chunk / MAP_CHUNKS),
				config: this.config,
			});
		}
	}

	private finishJob(id: number, ok: boolean, buildTime: number, writeTime: number) {
		const job = this.jobs.get(id);
		if (!job) return; // Already reaped.
		this.jobs.delete(id);
		this.idle.push(job.actor);

		if (job.epoch === this.epoch) {
			if (ok) {
				this.built += 1;
				this.buildTotal += buildTime;
				this.writeTotal += writeTime;
				this.chunkDone();
			} else {
				const attempts = (this.attempts.get(job.chunk) ?? 0) + 1;
				this.attempts.set(job.chunk, attempts);
				if (attempts < MAX_ATTEMPTS) {
					this.queue.push(job.chunk);
				} else {
					this.logger.Error("Chunk {Chunk} failed {Attempts} times; leaving it empty", job.chunk, attempts);
					this.chunkDone();
				}
			}
		}
	}

	/** Gives up on jobs that never reported, so their workers aren't lost for good. */
	private reap() {
		const now = os.clock();
		const expired = new Array<number>();
		for (const [id, job] of this.jobs) {
			if (now - job.startedAt > JOB_TIMEOUT) expired.push(id);
		}
		for (const id of expired) {
			const job = this.jobs.get(id)!;
			this.logger.Warn(
				"{Worker} timed out on chunk {Chunk}; returning it to the pool",
				job.actor.Name,
				job.chunk,
			);
			this.finishJob(id, false, 0, 0);
		}
	}

	private chunkDone() {
		this.remaining -= 1;
		this.progressAtom((CHUNK_SHARE * (CHUNK_COUNT - this.remaining)) / CHUNK_COUNT);
		if (this.remaining > 0) {
			this.statusAtom(this.status(true));
			return;
		}

		const epoch = this.epoch;
		task.spawn(() => {
			const ground = this.bakeGround(epoch);
			if (!ground) return; // A newer generation took over.
			const map = this.buildMap(ground, epoch);
			if (!map) return;
			this.lastSeconds = os.clock() - this.startedAt;
			this.statusAtom(this.status(false));
			this.progressAtom(1);
			this.mapAtom(map);
			this.logger.Info(
				"Generated planet {Planet} ({Kind}, seed {Seed}) in {Seconds}s",
				this.planet,
				this.config.kind,
				this.config.seed,
				math.round(this.lastSeconds * 10) / 10,
			);
		});
	}

	/** Raycasts the written terrain every GROUND_STEP studs. Undefined if epoch `epoch` was dropped meanwhile. */
	private bakeGround(epoch: number): Array<number> | undefined {
		const sampler = this.sampler!;
		const params = new RaycastParams();
		params.FilterType = Enum.RaycastFilterType.Include;
		params.FilterDescendantsInstances = [Workspace.Terrain];
		params.IgnoreWater = true;
		const down = new Vector3(0, WORLD_BOTTOM - WORLD_TOP - 16, 0);

		const ground = new Array<number>(GROUND_POINTS * GROUND_POINTS);
		for (let row = 0; row < GROUND_POINTS; row++) {
			if (row > 0 && row % BAKE_ROWS === 0) {
				this.progressAtom(CHUNK_SHARE + (BAKE_SHARE * row) / GROUND_POINTS);
				task.wait();
				if (epoch !== this.epoch) return undefined;
			}
			const z = -MAP_HALF + row * GROUND_STEP;
			for (let column = 0; column < GROUND_POINTS; column++) {
				const x = -MAP_HALF + column * GROUND_STEP;
				const hit = Workspace.Raycast(new Vector3(x, WORLD_TOP + 8, z), down, params);
				// A chunk that failed to build has no terrain: fall back to the heightmap.
				ground[row * GROUND_POINTS + column] = hit ? hit.Position.Y : sampler.height(x, z);
			}
		}
		return ground;
	}

	/** The map, once its props are settled, a slice a frame. Undefined if epoch `epoch` was dropped meanwhile. */
	private buildMap(ground: ReadonlyArray<number>, epoch: number): PlanetMap | undefined {
		const sampler = this.sampler!;
		const last = GROUND_POINTS - 1;
		const heightAt = (x: number, z: number) => {
			const gx = math.clamp((x + MAP_HALF) / GROUND_STEP, 0, last);
			const gz = math.clamp((z + MAP_HALF) / GROUND_STEP, 0, last);
			const x0 = math.min(math.floor(gx), last - 1);
			const z0 = math.min(math.floor(gz), last - 1);
			const fx = gx - x0;
			const i = z0 * GROUND_POINTS + x0;
			const near = ground[i] + (ground[i + 1] - ground[i]) * fx;
			const far = ground[i + GROUND_POINTS] + (ground[i + GROUND_POINTS + 1] - ground[i + GROUND_POINTS]) * fx;
			return near + (far - near) * (gz - z0);
		};
		// Between grid points the ground is interpolated, so the grid points bound it.
		const perCell = CELL_STUDS / GROUND_STEP;
		const groundRange = (cell: number, size: number) => {
			const [gx, gz] = cellCoords(cell);
			let low = math.huge;
			let high = -math.huge;
			for (let row = gz * perCell; row <= (gz + size) * perCell; row++) {
				for (let column = gx * perCell; column <= (gx + size) * perCell; column++) {
					const height = ground[math.min(row, last) * GROUND_POINTS + math.min(column, last)];
					low = math.min(low, height);
					high = math.max(high, height);
				}
			}
			return [low, high] as const;
		};

		// Props and ores were placed on the heightmap: settle them onto the real ground.
		// Ores sit on their cell's highest point, like a drill would, and skirt down the slope.
		const ores = new Array<OreDeposit>();
		let settled = 0;
		const folders = this.props.GetChildren();
		for (let index = 0; index < folders.size(); index++) {
			for (const model of folders[index].GetChildren()) {
				if (!model.IsA("Model")) continue;
				settled++;
				if (settled % SETTLE_PER_FRAME === 0) {
					const settling = 1 - CHUNK_SHARE - BAKE_SHARE;
					this.progressAtom(CHUNK_SHARE + BAKE_SHARE + (settling * index) / folders.size());
					task.wait();
					if (epoch !== this.epoch) return undefined;
				}
				const pivot = model.GetPivot();
				const cell = model.GetAttribute("Cell");
				const y = typeIs(cell, "number") ? groundRange(cell, 1)[1] : heightAt(pivot.X, pivot.Z);
				model.PivotTo(pivot.add(new Vector3(0, y - pivot.Y, 0)));
				if (!typeIs(cell, "number") || !CollectionService.HasTag(model, "Ore")) continue;
				ores.push({
					resource: model.GetAttribute("Resource") as ResourceId,
					cell,
					position: model.GetPivot().Position,
					model,
				});
			}
		}

		return {
			epoch: this.epoch,
			planet: this.planet,
			kind: this.config.kind,
			landing: new Vector3(0, heightAt(0, 0), 0),
			dropZones: sampler.pads.map((pad) => new Vector3(pad.x, heightAt(pad.x, pad.z), pad.z)),
			ores,
			props: this.props,
			heightAt,
			groundRange,
			isLiquid(x: number, z: number) {
				return sampler.isLiquid(x, z);
			},
		};
	}

	private status(generating: boolean): TerrainDebugState {
		const built = math.max(this.built, 1);
		return {
			config: this.configJson,
			planet: this.planet,
			epoch: this.epoch,
			generating,
			loadedChunks: CHUNK_COUNT - this.remaining,
			totalChunks: CHUNK_COUNT,
			buildMs: (this.buildTotal / built) * 1000,
			writeMs: (this.writeTotal / built) * 1000,
			seconds: this.lastSeconds,
		};
	}
}
