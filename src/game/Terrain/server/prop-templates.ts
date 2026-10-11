import { ServerStorage } from "@rbxts/services";

import { RESOURCE_ORDER, RESOURCES } from "game/Base/shared/resources";
import { oreTemplate, PROP_NAMES } from "game/Terrain/shared/assets";

/**
 * Templates for everything the generator places, built from Parts. A Model
 * with the same name in `ServerStorage.Assets.TerrainProps` (the game place's
 * `assets/ServerStorage/TerrainProps`) wins over the placeholder, so real art
 * drops in without code changes. Templates must have their pivot at the ground
 * contact point: workers place them with PivotTo and scale props with ScaleTo.
 */

const BARK = Color3.fromRGB(105, 74, 48);
const BARK_DARK = Color3.fromRGB(74, 52, 38);
const BIRCH_BARK = Color3.fromRGB(226, 222, 208);
const SPRUCE = Color3.fromRGB(46, 92, 60);
const OAK = Color3.fromRGB(78, 140, 62);
const BIRCH = Color3.fromRGB(140, 180, 80);
const SNOW = Color3.fromRGB(240, 244, 248);
const DUST_ROCK = Color3.fromRGB(156, 124, 96);
const CHAR = Color3.fromRGB(38, 32, 30);
const EMBER = Color3.fromRGB(255, 110, 40);
const STONE = Color3.fromRGB(90, 90, 94);

function part(
	model: Model,
	size: Vector3,
	cframe: CFrame,
	color: Color3,
	material: Enum.Material,
	shape: Enum.PartType = Enum.PartType.Block,
	collide = false,
) {
	const p = new Instance("Part");
	p.Anchored = true;
	p.CanCollide = collide;
	p.CanTouch = false;
	p.Shape = shape;
	p.Size = size;
	p.CFrame = cframe;
	p.Color = color;
	p.Material = material;
	p.Parent = model;
}

function trunk(model: Model, width: number, height: number, color: Color3) {
	part(
		model,
		new Vector3(width, height, width),
		new CFrame(0, height / 2 - 1, 0),
		color,
		Enum.Material.Wood,
		Enum.PartType.Block,
		true,
	);
}

function spruce(snowy: boolean) {
	return (model: Model) => {
		trunk(model, 1.2, 9, BARK_DARK);
		[9, 7, 5, 3].forEach((width, i) => {
			const cf = new CFrame(0, 4.9 + i * 2.4, 0).mul(CFrame.Angles(0, ((i + 1) * math.pi) / 4, 0));
			part(model, new Vector3(width, 3, width), cf, SPRUCE, Enum.Material.SmoothPlastic);
			if (snowy) {
				const cap = cf.mul(new CFrame(0, 1.7, 0));
				part(model, new Vector3(width * 0.8, 0.6, width * 0.8), cap, SNOW, Enum.Material.Snow);
			}
		});
	};
}

const BUILDERS: Record<string, (model: Model) => void> = {
	Spruce: spruce(false),
	SnowySpruce: spruce(true),

	Oak: (model) => {
		trunk(model, 1.6, 8, BARK);
		part(model, Vector3.one.mul(9), new CFrame(0, 9, 0), OAK, Enum.Material.SmoothPlastic, Enum.PartType.Ball);
		part(model, Vector3.one.mul(6), new CFrame(2, 11.5, 1), OAK, Enum.Material.SmoothPlastic, Enum.PartType.Ball);
	},

	Birch: (model) => {
		trunk(model, 1, 10, BIRCH_BARK);
		part(model, new Vector3(6, 5, 6), new CFrame(0, 10, 0), BIRCH, Enum.Material.SmoothPlastic);
		const top = new CFrame(0, 13, 0).mul(CFrame.Angles(0, math.pi / 4, 0));
		part(model, new Vector3(4, 3, 4), top, BIRCH, Enum.Material.SmoothPlastic);
	},

	// A weathered column of stacked, shrinking blocks.
	RockSpire: (model) => {
		const blocks: ReadonlyArray<[size: number, height: number, y: number, yaw: number]> = [
			[5, 7, 2.5, 0.3],
			[3.6, 7, 8.5, 0.9],
			[2.2, 6, 14.5, 1.6],
		];
		for (const [size, height, y, yaw] of blocks) {
			const cf = new CFrame(y * 0.02, y, 0).mul(CFrame.Angles(0, yaw, 0.05));
			const material = Enum.Material.Sandstone;
			part(model, new Vector3(size, height, size), cf, DUST_ROCK, material, Enum.PartType.Block, true);
		}
	},

	// Burnt, leaning spikes with a glowing tip.
	CharredSpike: (model) => {
		const spikes: ReadonlyArray<[height: number, x: number, z: number, tiltX: number, tiltZ: number]> = [
			[11, 0, 0, 0.05, -0.1],
			[7, 1.6, 0.8, 0.3, 0.25],
			[5, -1.3, 1, -0.25, -0.3],
		];
		for (const [height, x, z, tiltX, tiltZ] of spikes) {
			const cf = new CFrame(x, -1, z).mul(CFrame.Angles(tiltX, 0, tiltZ)).mul(new CFrame(0, height / 2, 0));
			part(model, new Vector3(1.2, height, 1.2), cf, CHAR, Enum.Material.Basalt, Enum.PartType.Block, true);
		}
		part(model, new Vector3(0.6, 1, 0.6), new CFrame(0.5, 10.4, 0), EMBER, Enum.Material.Neon);
	},
};

/**
 * A flat stone slab filling most of an 8-stud cell, with lumps of ore on top.
 * Deposits sit on their cell's highest ground, so the slab reaches well down to
 * meet the low side of the steepest slope ores are placed on.
 */
function ore(color: Color3) {
	const lumps: ReadonlyArray<[x: number, z: number, size: number]> = [
		[-1.6, -1.4, 2.4],
		[1.5, -1.2, 2],
		[0.2, 1.6, 2.6],
		[-2.2, 1.8, 1.4],
		[2.3, 1.9, 1.6],
	];
	return (model: Model) => {
		const slab = color.Lerp(STONE, 0.6);
		part(model, new Vector3(7, 5, 7), new CFrame(0, -1.9, 0), slab, Enum.Material.Slate, Enum.PartType.Block, true);
		lumps.forEach(([x, z, size], i) => {
			const cf = new CFrame(x, 0.6 + size * 0.15, z).mul(CFrame.Angles(0, i * 0.7, 0));
			const lump = new Vector3(size, size * 0.6, size);
			part(model, lump, cf, color, Enum.Material.SmoothPlastic, Enum.PartType.Block, true);
		});
	};
}

function placeholder(name: string, build: (model: Model) => void): Model {
	const model = new Instance("Model");
	model.Name = name;
	build(model);
	model.WorldPivot = new CFrame();
	return model;
}

/** Builds `parent.Templates` with one Model per prop and ore template name, before any worker needs it. */
export function createTemplates(parent: Instance): Folder {
	const real = ServerStorage.FindFirstChild("Assets")?.FindFirstChild("TerrainProps");
	const folder = new Instance("Folder");
	folder.Name = "Templates";

	const add = (name: string, build?: (model: Model) => void) => {
		const model = real?.FindFirstChild(name);
		if (model && model.IsA("Model")) {
			model.Clone().Parent = folder;
		} else if (build) {
			placeholder(name, build).Parent = folder;
		} else {
			warn(`[Terrain] ${name} has no model in ServerStorage.Assets.TerrainProps and no placeholder`);
		}
	};
	for (const name of PROP_NAMES) add(name, BUILDERS[name]);
	for (const resource of RESOURCE_ORDER) add(oreTemplate(resource), ore(RESOURCES[resource].color));

	folder.Parent = parent;
	return folder;
}
