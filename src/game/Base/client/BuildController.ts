import { Controller, OnStart } from "@flamework/core";
import { computed, effect, untracked } from "@rbxts/charm";
import { CollectionService, Players, RunService, UserInputService, Workspace } from "@rbxts/services";

import { CharacterController } from "core/Character/client/CharacterController";
import { COLORS } from "core/Interface/client/theme";
import { baseStateAtom, type BuildMode, buildModeAtom, canAfford, toggleBuildMode } from "game/Base/client/base-state";
import { BaseMessage, baseMessaging } from "game/Base/shared/base-network";
import { BUILD_RANGE, BUILDABLE, BUILDINGS, type BuildingKind } from "game/Base/shared/buildings";
import { deployedAtom } from "game/Planets/client/planets-state";
import { CELL_STUDS, cellAt, cellCenter, cellCoords, GRID_SIZE } from "game/Terrain/shared/map";

/** The number keys, so the build bar's nth card is key n. */
const NUMBER_KEYS = [
	Enum.KeyCode.One,
	Enum.KeyCode.Two,
	Enum.KeyCode.Three,
	Enum.KeyCode.Four,
	Enum.KeyCode.Five,
	Enum.KeyCode.Six,
	Enum.KeyCode.Seven,
	Enum.KeyCode.Eight,
	Enum.KeyCode.Nine,
];
const MODE_KEYS = new Map<Enum.KeyCode, BuildMode>([[Enum.KeyCode.X, "remove"]]);
BUILDABLE.forEach((kind, index) => MODE_KEYS.set(NUMBER_KEYS[index], kind));

const RAY_LENGTH = 1000;
/** How far above and below a cell's centre to look for the ground under it. */
const GROUND_SEARCH = 500;
const GHOST_TRANSPARENCY = 0.55;
const RING_TRANSPARENCY = 0.85;

/** The building whose footprint overlaps the `size`×`size` block of cells at (gx, gz), if any. */
function buildingOver(gx: number, gz: number, size: number): Model | undefined {
	// ponytail: scans every building each frame; index them by cell if bases grow to thousands.
	const buildings = Workspace.FindFirstChild("Base")?.FindFirstChild("Buildings");
	for (const model of buildings?.GetChildren() ?? []) {
		const cell = model.GetAttribute("Cell");
		const kind = model.GetAttribute("Kind");
		if (!typeIs(cell, "number") || !typeIs(kind, "string")) continue;
		const [x, z] = cellCoords(cell);
		const span = BUILDINGS[kind as BuildingKind]?.size ?? 1;
		if (gx < x + span && x < gx + size && gz < z + span && z < gz + size) return model as Model;
	}
	return undefined;
}

/** The building covering the cell under a world point, if any. */
function buildingAt(point: Vector3) {
	const cell = cellAt(point.X, point.Z);
	if (cell === undefined) return undefined;
	const [gx, gz] = cellCoords(cell);
	return buildingOver(gx, gz, 1);
}

/** A local, non-colliding part for the ghost. Hidden until the first frame places it. */
function ghostPart(parent: Instance, size: Vector3, shape: Enum.PartType = Enum.PartType.Block) {
	const part = new Instance("Part");
	part.Anchored = true;
	part.CanCollide = false;
	part.CanQuery = false;
	part.CanTouch = false;
	part.CastShadow = false;
	part.Material = Enum.Material.Neon;
	part.Shape = shape;
	part.Size = size;
	part.Transparency = 1;
	part.Parent = parent;
	return part;
}

/**
 * Building and removing, while the local player is on a planet with the mission
 * on. 1-3 (or a build bar card) pick a building and X the remove tool; picking
 * the same again, Q or Esc puts it down. A building shows as a ghost on the cell
 * under the mouse, green where the server should accept it and red where it
 * won't; R turns it and a click asks the server to build it. The remove tool
 * outlines the building under the mouse in red and a click asks to remove it.
 * While either is out, tools stay unequipped so clicks don't also fire the
 * Blaster; putting it down draws again whatever was drawn before.
 */
@Controller()
export class BuildController implements OnStart {
	/** Quarter turns, kept between buildings. Cosmetic until the server's models face their rotation. */
	private rotation = 0;
	/** The tool building put away, to draw again when building is put down. */
	private drawn: Tool | undefined;

	constructor(private readonly characterController: CharacterController) {}

	onStart() {
		// ponytail: keyboard and mouse only; touch needs on-screen place, rotate and cancel buttons and a tap to aim.
		const enabled = computed(() => deployedAtom() && baseStateAtom()?.phase === "active");
		effect(() => {
			if (!enabled()) buildModeAtom(undefined);
		});
		effect(() => {
			const mode = buildModeAtom();
			if (mode === undefined) return;
			return untracked(() => this.run(mode));
		});

		UserInputService.InputBegan.Connect((input) => {
			// Not `processed`: Roblox's hotbar may claim the number keys too, and Esc both opens the menu and cancels.
			if (!enabled() || UserInputService.GetFocusedTextBox()) return;
			const key = input.KeyCode;
			const mode = MODE_KEYS.get(key);

			if (mode !== undefined) toggleBuildMode(mode);
			else if (key === Enum.KeyCode.Q || key === Enum.KeyCode.Escape) buildModeAtom(undefined);
			else if (key === Enum.KeyCode.R) this.rotation = (this.rotation + 1) % 4;
		});
	}

	/** Puts the ghost or the remove outline under the mouse until the returned cleanup runs. */
	private run(mode: BuildMode) {
		const kind = mode === "remove" ? undefined : mode;
		const def = kind ? BUILDINGS[kind] : undefined;
		const size = def ? def.size : 1;

		const folder = new Instance("Folder");
		folder.Name = "BuildGhost";
		const ghost = def
			? ghostPart(folder, new Vector3(size * CELL_STUDS - 0.4, CELL_STUDS, size * CELL_STUDS - 0.4))
			: undefined;
		const ring =
			def?.range !== undefined
				? ghostPart(folder, new Vector3(0.2, def.range * 2, def.range * 2), Enum.PartType.Cylinder)
				: undefined;
		const highlight = new Instance("Highlight");
		highlight.Enabled = false;
		highlight.FillColor = COLORS.danger;
		highlight.FillTransparency = 0.5;
		highlight.OutlineColor = COLORS.danger;
		highlight.Parent = folder;
		folder.Parent = Workspace;

		const terrain = new RaycastParams();
		terrain.FilterType = Enum.RaycastFilterType.Include;
		terrain.FilterDescendantsInstances = [Workspace.Terrain];
		const solid = new RaycastParams();
		solid.FilterType = Enum.RaycastFilterType.Include;

		// The cell a click acts on: the ghost's -X/-Z corner, or the outlined building's.
		let target: [x: number, z: number] | undefined;

		// Clicks belong to building now. Remember what was drawn, to draw it again once building is put down.
		const rig = this.characterController.getRig();
		this.drawn = rig?.FindFirstChildOfClass("Tool") ?? this.drawn;
		rig?.Humanoid.UnequipTools();

		const frame = RunService.RenderStepped.Connect(() => {
			target = undefined;
			// Roblox's hotbar draws the tool in its slot when 1-3 is pressed, maybe just after this mode began.
			const current = this.characterController.getRig();
			if (current?.FindFirstChildOfClass("Tool")) current.Humanoid.UnequipTools();

			const camera = Workspace.CurrentCamera;
			if (!camera) return;
			const mouse = UserInputService.GetMouseLocation();
			const ray = camera.ViewportPointToRay(mouse.X, mouse.Y);

			if (!def || !ghost) {
				const buildings = Workspace.FindFirstChild("Base")?.FindFirstChild("Buildings");
				solid.FilterDescendantsInstances = buildings ? [Workspace.Terrain, buildings] : [Workspace.Terrain];
				const hit = Workspace.Raycast(ray.Origin, ray.Direction.mul(RAY_LENGTH), solid);
				// Just inside whatever was hit, so a building's side counts as its own cell, not its neighbour's.
				const model = hit ? buildingAt(hit.Position.sub(hit.Normal.mul(0.5))) : undefined;
				const corner = model?.GetAttribute("Cell");

				if (model && typeIs(corner, "number") && model.GetAttribute("Kind") !== "core") {
					highlight.Adornee = model;
					target = cellCoords(corner);
				}
				highlight.Enabled = target !== undefined;
				return;
			}

			const hit = Workspace.Raycast(ray.Origin, ray.Direction.mul(RAY_LENGTH), terrain);
			// Offset by half the extra size, so a block bigger than a cell centres on the cursor.
			const half = ((size - 1) * CELL_STUDS) / 2;
			const corner = hit ? cellAt(hit.Position.X - half, hit.Position.Z - half) : undefined;
			if (!hit || corner === undefined) {
				ghost.Transparency = 1;
				if (ring) ring.Transparency = 1;
				return;
			}

			const [gx, gz] = cellCoords(corner);
			const centre = cellCenter(corner, size);
			const ground =
				Workspace.Raycast(
					centre.add(new Vector3(0, GROUND_SEARCH, 0)),
					new Vector3(0, -2 * GROUND_SEARCH, 0),
					terrain,
				)?.Position.Y ?? hit.Position.Y;
			const base = new Vector3(centre.X, ground, centre.Z);
			const root = this.characterController.getRig()?.HumanoidRootPart.Position;

			// For the colour only: the server decides.
			const valid =
				gx + size <= GRID_SIZE &&
				gz + size <= GRID_SIZE &&
				buildingOver(gx, gz, size) === undefined &&
				(kind !== "drill" ||
					CollectionService.GetTagged("Ore").some((ore) => ore.GetAttribute("Cell") === corner)) &&
				canAfford(baseStateAtom()?.pool ?? [], def.cost) &&
				root !== undefined &&
				// Across the ground, like the server's check.
				new Vector2(root.X - base.X, root.Z - base.Z).Magnitude <= BUILD_RANGE;
			const color = valid ? COLORS.confirm : COLORS.danger;

			ghost.CFrame = new CFrame(base.add(new Vector3(0, CELL_STUDS / 2, 0))).mul(
				CFrame.Angles(0, (this.rotation * math.pi) / 2, 0),
			);
			ghost.Color = color;
			ghost.Transparency = GHOST_TRANSPARENCY;
			if (ring) {
				// A cylinder's axis is X, so tip it onto its side to lie flat.
				ring.CFrame = new CFrame(base).mul(CFrame.Angles(0, 0, math.pi / 2));
				ring.Color = color;
				ring.Transparency = RING_TRANSPARENCY;
			}
			target = [gx, gz];
		});

		const click = UserInputService.InputBegan.Connect((input, processed) => {
			if (processed || input.UserInputType !== Enum.UserInputType.MouseButton1 || !target) return;
			const [x, z] = target;
			if (kind) baseMessaging.server.emit(BaseMessage.Place, { kind, x, z, rotation: this.rotation });
			else baseMessaging.server.emit(BaseMessage.Remove, { x, z });
		});

		return () => {
			frame.Disconnect();
			click.Disconnect();
			folder.Destroy();
			// Switching to another building keeps the tool away. Putting building down draws it again, if it's
			// still in this character's backpack: a new character has a new backpack.
			if (buildModeAtom() !== undefined) return;
			const tool = this.drawn;
			const humanoid = this.characterController.getRig()?.Humanoid;
			this.drawn = undefined;
			if (tool && humanoid && tool.Parent === Players.LocalPlayer.FindFirstChild("Backpack")) {
				humanoid.EquipTool(tool);
			}
		};
	}
}
