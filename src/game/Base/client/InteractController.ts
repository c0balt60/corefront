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
import { groundRing, pointedAt } from "game/Base/client/BuildController";
import { BaseMessage, baseMessaging } from "game/Base/shared/base-network";
import {
	BUILD_RANGE,
	BUILD_TOOL,
	BUILDINGS,
	type BuildingKind,
	isPowered,
	linkReach,
	MINE_SECONDS,
	TRANSFER_RANGE,
} from "game/Base/shared/buildings";
import { type ResourceId, RESOURCES } from "game/Base/shared/resources";
import { deployedAtom, starMapOpenAtom } from "game/Planets/client/planets-state";
import { cellCenter, cellCoords } from "game/Terrain/shared/map";

/** Most seconds between the two clicks of a double click. */
const DOUBLE_CLICK = 0.3;

/** A building's -X/-Z corner cell, as the server's messages take it. */
export function cellOf(model: Model) {
	const [x, z] = cellCoords(model.GetAttribute("Cell") as number);
	return { x, z };
}

/** Whether clicking `building` while `selected` is open links or unlinks them: a power node, and something on the power network in its range. */
function linksTo(selected: Model | undefined, building: Model): boolean {
	if (!selected || selected === building) return false;
	const node = selected.GetAttribute("Kind") as BuildingKind;
	const other = building.GetAttribute("Kind") as BuildingKind;
	const cell = (model: Model) => model.GetAttribute("Cell") as number;
	return (
		BUILDINGS[node].node !== undefined && isPowered(other) && linkReach(node, cell(selected), other, cell(building))
	);
}

/**
 * Clicking ore and buildings, with no tool out or the Build tool out with nothing picked. What a
 * click would act on is outlined: any building, or ore within `TRANSFER_RANGE`. Holding a click on
 * ore mines it, one at a time, with a beam to it. Clicking a building opens its panel
 * (`selectedAtom`), until something else is clicked or the character walks out of `BUILD_RANGE`;
 * one that reaches out (turrets, menders, power nodes) also shows its range as a ring on the ground.
 * While a power node's is open, clicking something in its range on the power network links or
 * unlinks it instead. Double-clicking a building also moves items: in what it takes from the pack
 * (everything for the Core or storage, ammo for a turret, inputs for a crafter, fuel for a
 * generator), then out what a drill or crafter made or a belt carries.
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
				clearRing =
					selected && range !== undefined
						? groundRing(selected.GetPivot().Position, range, COLORS.text)
						: () => {};
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
			} else if (linksTo(selectedAtom(), building)) {
				const { x, z } = cellOf(selectedAtom()!);
				const to = cellOf(building);
				baseMessaging.server.emit(BaseMessage.Link, { x, z, toX: to.x, toZ: to.z });
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
		const loads = (def.turret && !def.turret.energy) || def.craft || def.store !== undefined || def.generator?.fuel;
		if (kind === "core" || loads) baseMessaging.server.emit(BaseMessage.Load, at);
		if (def.drill || def.craft || def.belt !== undefined) baseMessaging.server.emit(BaseMessage.Collect, at);
	}

	/** How far the character stands from `point`, across the ground, like the server measures. Infinite without one. */
	private distanceTo(point: Vector3): number {
		const root = this.characterController.getRig()?.HumanoidRootPart.Position;
		return root ? new Vector2(root.X - point.X, root.Z - point.Z).Magnitude : math.huge;
	}
}
