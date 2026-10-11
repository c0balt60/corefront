import { Controller, OnStart } from "@flamework/core";
import { computed, effect, untracked } from "@rbxts/charm";
import { CollectionService, RunService, UserInputService, Workspace } from "@rbxts/services";

import { CharacterController } from "core/Character/client/CharacterController";
import { COLORS } from "core/Interface/client/theme";
import {
	baseStateAtom,
	buildModeAtom,
	equippedAtom,
	inventoryAtom,
	nearSelectedAtom,
	selectedAtom,
} from "game/Base/client/base-state";
import { pointedAt } from "game/Base/client/BuildController";
import { BaseMessage, baseMessaging } from "game/Base/shared/base-network";
import {
	BUILD_RANGE,
	BUILD_TOOL,
	BUILDINGS,
	type BuildingKind,
	MINE_SECONDS,
	TRANSFER_RANGE,
} from "game/Base/shared/buildings";
import { type ResourceId, RESOURCES } from "game/Base/shared/resources";
import { deployedAtom, starMapOpenAtom } from "game/Planets/client/planets-state";
import { cellCenter, cellCoords } from "game/Terrain/shared/map";

/** Most seconds between the two clicks of a double click. */
const DOUBLE_CLICK = 0.3;
/** Points round a range ring, each set on the ground, and how far above and below one to look for it. */
const RING_POINTS = 64;
const RING_SEARCH = 200;

/** A building's -X/-Z corner cell, as the server's messages take it. */
export function cellOf(model: Model) {
	const [x, z] = cellCoords(model.GetAttribute("Cell") as number);
	return { x, z };
}

/**
 * Clicking ore and buildings, with no tool out or the Build tool out with nothing picked. What a
 * click would act on is outlined: any building, or ore within `TRANSFER_RANGE`. Holding a click on
 * ore mines it, one at a time, with a beam to it. Clicking a building opens its panel
 * (`selectedAtom`), until something else is clicked or the character walks out of `BUILD_RANGE`;
 * one that reaches out (turrets, menders) also shows its range as a ring on the ground.
 * Double-clicking it also moves items: in what it takes from the pack (everything for the Core,
 * ammo for a turret, coal for a smelter), then out what a drill or smelter made or a belt carries.
 */
@Controller()
export class InteractController implements OnStart {
	constructor(private readonly characterController: CharacterController) {}

	onStart() {
		// ponytail: mouse only, like building; touch needs a tap to aim and a hold to mine.
		const enabled = computed(() => {
			const tool = equippedAtom();
			const idle = tool === undefined || (tool.Name === BUILD_TOOL && buildModeAtom() === undefined);
			return idle && deployedAtom() && !starMapOpenAtom() && baseStateAtom()?.phase === "active";
		});
		effect(() => {
			if (enabled()) return untracked(() => this.run());
			selectedAtom(undefined);
		});
	}

	/** Outlines, mines and opens panels until the returned cleanup runs. */
	private run() {
		const highlight = new Instance("Highlight");
		highlight.Enabled = false;
		highlight.FillTransparency = 1;
		highlight.OutlineColor = COLORS.text;
		highlight.Parent = Workspace;
		// What a click acts on: the building under the mouse, or ore in reach.
		let hovered: { readonly building?: Model; readonly ore?: Model } = {};
		// The ore a held click is mining, and when a building was last clicked, to spot a double click.
		let mining: Model | undefined;
		let clicked = 0;
		// The building the range ring is round, if any.
		let ringed: Model | undefined;
		let clearRing = () => {};

		const frame = RunService.RenderStepped.Connect(() => {
			const { building, prop } = pointedAt();
			const ore = prop && CollectionService.HasTag(prop, "Ore") ? (prop as Model) : undefined;
			const reachable = ore && this.distanceTo(cellCenter(ore.GetAttribute("Cell") as number)) <= TRANSFER_RANGE;
			hovered = { building, ore: reachable ? ore : undefined };

			const selected = selectedAtom();
			highlight.Adornee = hovered.building ?? hovered.ore ?? mining ?? selected;
			highlight.Enabled = highlight.Adornee !== undefined;
			if (selected !== ringed) {
				clearRing();
				ringed = selected;
				const range = selected && BUILDINGS[selected.GetAttribute("Kind") as BuildingKind].range;
				clearRing = selected && range !== undefined ? this.ring(selected.GetPivot().Position, range) : () => {};
			}
			if (!selected) return;
			const distance = this.distanceTo(selected.GetPivot().Position);
			if (!selected.Parent || distance > BUILD_RANGE) selectedAtom(undefined);
			else nearSelectedAtom(distance <= TRANSFER_RANGE);
		});

		const press = UserInputService.InputBegan.Connect((input, processed) => {
			if (processed || input.UserInputType !== Enum.UserInputType.MouseButton1) return;
			const { building, ore } = hovered;
			if (ore) {
				mining = ore;
				task.spawn(() => this.mine(ore, () => mining === ore));
			} else if (!building) {
				selectedAtom(undefined);
			} else if (selectedAtom() === building && os.clock() - clicked <= DOUBLE_CLICK) {
				this.quickTransfer(building);
				clicked = 0;
			} else {
				selectedAtom(building);
				clicked = os.clock();
			}
		});
		const release = UserInputService.InputEnded.Connect((input) => {
			if (input.UserInputType === Enum.UserInputType.MouseButton1) mining = undefined;
		});

		return () => {
			frame.Disconnect();
			press.Disconnect();
			release.Disconnect();
			highlight.Destroy();
			clearRing();
			mining = undefined;
		};
	}

	/** An outline `radius` round `center`, following the ground, until the returned cleanup runs. */
	private ring(center: Vector3, radius: number): () => void {
		const params = new RaycastParams();
		params.FilterType = Enum.RaycastFilterType.Include;
		params.FilterDescendantsInstances = [Workspace.Terrain];
		const down = new Vector3(0, -2 * RING_SEARCH, 0);
		const points = new Array<Attachment>();
		for (let i = 0; i < RING_POINTS; i++) {
			const angle = (i / RING_POINTS) * 2 * math.pi;
			const x = center.X + radius * math.cos(angle);
			const z = center.Z + radius * math.sin(angle);
			const ground = Workspace.Raycast(new Vector3(x, center.Y + RING_SEARCH, z), down, params);
			// On Terrain, which sits at the origin, so its position is where it is in the world.
			const point = new Instance("Attachment");
			point.Position = new Vector3(x, (ground?.Position.Y ?? center.Y) + 0.3, z);
			point.Parent = Workspace.Terrain;
			points.push(point);
		}
		points.forEach((point, i) => {
			const beam = new Instance("Beam");
			beam.Attachment0 = point;
			beam.Attachment1 = points[(i + 1) % RING_POINTS];
			beam.Color = new ColorSequence(COLORS.text);
			beam.FaceCamera = true;
			beam.LightEmission = 1;
			beam.Segments = 1;
			beam.Transparency = new NumberSequence(0.35);
			beam.Width0 = 0.5;
			beam.Width1 = 0.5;
			beam.Parent = point;
		});
		return () => points.forEach((point) => point.Destroy());
	}

	/** Mines `ore` while `held()`: one every `MINE_SECONDS`, until the pack fills or the character leaves its reach. */
	private mine(ore: Model, held: () => boolean) {
		const cell = ore.GetAttribute("Cell") as number;
		const [x, z] = cellCoords(cell);
		const stopBeam = this.beam(ore);
		while (held() && ore.Parent && this.distanceTo(cellCenter(cell)) <= TRANSFER_RANGE) {
			const { items, capacity } = inventoryAtom();
			const full = items.reduce((sum, stack) => sum + stack.amount, 0) >= capacity;
			// Full, it still asks once, so the server says why it stops.
			baseMessaging.server.emit(BaseMessage.Mine, { x, z });
			if (full) break;
			task.wait(MINE_SECONDS);
		}
		stopBeam();
	}

	/** A beam from the character to `ore`, in its colour, until the returned cleanup runs. */
	private beam(ore: Model): () => void {
		const root = this.characterController.getRig()?.HumanoidRootPart;
		const part = ore.PrimaryPart ?? ore.FindFirstChildWhichIsA("BasePart", true);
		if (!root || !part) return () => {};
		const from = new Instance("Attachment");
		from.Parent = root;
		const to = new Instance("Attachment");
		to.Parent = part;
		const beam = new Instance("Beam");
		beam.Attachment0 = from;
		beam.Attachment1 = to;
		beam.Color = new ColorSequence(RESOURCES[ore.GetAttribute("Resource") as ResourceId].color);
		beam.FaceCamera = true;
		beam.LightEmission = 1;
		beam.Width0 = 0.2;
		beam.Width1 = 0.6;
		beam.Parent = from;
		return () => {
			from.Destroy();
			to.Destroy();
		};
	}

	/** A double click's transfer: in what the building takes from the pack, then out what it made. */
	private quickTransfer(building: Model) {
		const kind = building.GetAttribute("Kind") as BuildingKind;
		const def = BUILDINGS[kind];
		const at = cellOf(building);
		if (kind === "core" || def.turret || def.craft) baseMessaging.server.emit(BaseMessage.Load, at);
		if (def.drill || def.craft || kind === "conveyor") baseMessaging.server.emit(BaseMessage.Collect, at);
	}

	/** How far the character stands from `point`, across the ground, like the server measures. Infinite without one. */
	private distanceTo(point: Vector3): number {
		const root = this.characterController.getRig()?.HumanoidRootPart.Position;
		return root ? new Vector2(root.X - point.X, root.Z - point.Z).Magnitude : math.huge;
	}
}
