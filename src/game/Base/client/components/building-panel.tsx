import { Workspace } from "@rbxts/services";
import Vide, { cleanup, Index, Show, source } from "@rbxts/vide";

import { Button } from "core/Interface/client/components/button";
import { COLORS, FONT_DISPLAY } from "core/Interface/client/theme";
import { HudBox, Label, Swatch } from "game/Base/client/components/base-hud";
import { BUILDINGS, type BuildingKind, MACHINE_SECONDS } from "game/Base/shared/buildings";
import { RESOURCE_ORDER, RESOURCES, type ResourceId, type ResourceStack } from "game/Base/shared/resources";
import { CELL_STUDS } from "game/Terrain/shared/map";

const WIDTH = 260;
const ROW = 18;
const SWATCH = 24;
const GAP = 4;
/** The title's height, and HudBox's padding top and bottom. */
const CHROME = 20 + 18;
const BUTTONS = 36;
/** Studs between the building and its panel, so the panel never covers a second click. */
const CLEARANCE = 3;

/** One line of the panel: a label, a value, and the ore it's about, if any. */
interface Row {
	readonly label: string;
	readonly value: string;
	readonly resource?: ResourceId;
}

interface BuildingPanelProps {
	readonly building: Model;
	/** The Core's storage, and the most of each resource it holds. */
	readonly pool: () => ReadonlyArray<ResourceStack>;
	readonly capacity: () => number;
	/** Whether the local player is close enough to move items in or out. */
	readonly near: () => boolean;
	readonly onCollect: () => void;
	readonly onLoad: () => void;
	/** Sorters: the ore to let through now, or undefined for none. */
	readonly onPick: (resource: ResourceId | undefined) => void;
	/** Belts: the ore on it, and taking all of one ore off it. */
	readonly ore: () => ReadonlyArray<ResourceId>;
	readonly onTake: (resource: ResourceId) => void;
}

interface OreButtonProps {
	readonly resource: () => ResourceId;
	readonly text?: () => string;
	/** Outlined while true. */
	readonly picked?: () => boolean;
	readonly layoutOrder: number;
	readonly onClick: () => void;
}

/** An ore's colour as a square button, with a count or nothing on it. */
function OreButton({ resource, text = () => "", picked = () => false, layoutOrder, onClick }: OreButtonProps) {
	return (
		<textbutton
			AutoButtonColor={true}
			BackgroundColor3={() => RESOURCES[resource()].color}
			BorderSizePixel={0}
			FontFace={FONT_DISPLAY}
			LayoutOrder={layoutOrder}
			Size={UDim2.fromOffset(SWATCH, SWATCH)}
			Text={text}
			TextColor3={COLORS.text}
			TextSize={13}
			TextStrokeTransparency={0.3}
			Activated={onClick}
		>
			<uistroke
				ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
				Color={() => (picked() ? COLORS.text : COLORS.stroke)}
				LineJoinMode={Enum.LineJoinMode.Miter}
				Thickness={() => (picked() ? 2.5 : 1)}
			/>
		</textbutton>
	);
}

/**
 * Floats beside a clicked building, on whichever side of the screen had more room when it opened,
 * or over a belt, which lies flat: its name, health and what it holds or does, and buttons to move
 * items in or out, greyed out until the local player is close enough. A Sorter's has a swatch for
 * every ore, the one it lets through outlined: clicking one lets that ore through instead, and
 * clicking the outlined one lets nothing through. A belt's has a swatch for each ore on it, with
 * its count: clicking one takes all of that ore. It has to live in PlayerGui, not on the
 * building, to take clicks.
 */
export function BuildingPanel({
	building,
	pool,
	capacity,
	near,
	onCollect,
	onLoad,
	onPick,
	ore,
	onTake,
}: BuildingPanelProps) {
	const kind = building.GetAttribute("Kind") as BuildingKind;
	const def = BUILDINGS[kind];
	const attributes = source(building.GetAttributes());
	cleanup(building.AttributeChanged.Connect(() => attributes(building.GetAttributes())));
	// Turning it remakes its parts, the body among them.
	const body = source(building.PrimaryPart);
	cleanup(building.GetPropertyChangedSignal("PrimaryPart").Connect(() => body(building.PrimaryPart)));
	const read = (name: string) => (attributes().get(name) as number | undefined) ?? 0;
	const filter = () => attributes().get("Filter") as ResourceId | undefined;
	const belt = kind === "conveyor";
	// Belts: from the body's middle to just over the belt's top.
	const lift = () => {
		const part = body();
		if (!belt || !part) return Vector3.zero;
		const [frame, size] = building.GetBoundingBox();
		return new Vector3(0, frame.Y + size.Y / 2 - part.Position.Y + CLEARANCE, 0);
	};
	// Anything else: right of it, unless it's on the right of the screen. Past its corners from any angle.
	const camera = Workspace.CurrentCamera;
	// Not `camera?.`: optional calls keep only the first of a LuaTuple, so indexing it would index a Vector3.
	const onScreen = camera ? camera.WorldToViewportPoint(building.GetPivot().Position)[0] : undefined;
	const side = camera && onScreen && onScreen.X > camera.ViewportSize.X / 2 ? -1 : 1;
	const beside = belt ? Vector3.zero : new Vector3(side * ((def.size * CELL_STUDS) / math.sqrt(2) + CLEARANCE), 0, 0);

	const rows = () => {
		const list: Array<Row> = [{ label: "HEALTH", value: `${math.ceil(read("Health"))} / ${read("MaxHealth")}` }];
		const made = attributes().get("Resource") as ResourceId | undefined;
		if (def.drill && made !== undefined) {
			list.push({ label: "RATE", value: `${read("Yield")} / ${MACHINE_SECONDS}s` });
			const stored = `${read("Stored")} / ${def.drill.storage}`;
			list.push({ label: RESOURCES[made].name.upper(), value: stored, resource: made });
		}
		if (def.craft) {
			const { input, output, amount, storage } = def.craft;
			list.push({ label: "RATE", value: `1 PER ${amount} / ${MACHINE_SECONDS}s` });
			list.push({
				label: RESOURCES[input].name.upper(),
				value: `${read("Input")} / ${storage}`,
				resource: input,
			});
			list.push({
				label: RESOURCES[output].name.upper(),
				value: `${read("Stored")} / ${storage}`,
				resource: output,
			});
		}
		if (def.turret) list.push({ label: "AMMO", value: `${read("Ammo")} / ${def.turret.magazine}` });
		if (def.repair !== undefined) list.push({ label: "REPAIRS", value: `${def.repair} / ${MACHINE_SECONDS}s` });
		if (def.range !== undefined) list.push({ label: "RANGE", value: `${def.range}` });
		if (kind === "core") {
			for (const { resource, amount } of pool()) {
				list.push({ label: RESOURCES[resource].name.upper(), value: `${amount} / ${capacity()}`, resource });
			}
		}
		return list;
	};

	const actions = new Array<[text: string, onClick: () => void]>();
	if (kind === "core") actions.push(["DEPOSIT ALL", onLoad]);
	if (def.turret) actions.push(["LOAD AMMO", onLoad]);
	if (def.craft) actions.push([`LOAD ${RESOURCES[def.craft.input].name.upper()}`, onLoad]);
	if (def.drill || def.craft || belt) actions.push(["COLLECT ALL", onCollect]);
	const sorter = kind === "sorter";
	// Below the rows: the swatches, then the buttons.
	const extra = (sorter || belt ? SWATCH + 8 : 0) + (actions.isEmpty() ? 0 : BUTTONS);
	// What's on a belt, as counts.
	const onBelt = () => {
		const carried = ore();
		return RESOURCE_ORDER.map((resource) => ({
			resource,
			amount: carried.filter((r) => r === resource).size(),
		})).filter((stack) => stack.amount > 0);
	};

	return (
		<billboardgui
			Name="BuildingPanel"
			Active={true}
			Adornee={body}
			AlwaysOnTop={true}
			LightInfluence={0}
			ResetOnSpawn={false}
			Size={() => UDim2.fromOffset(WIDTH, CHROME + ROW * rows().size() + extra)}
			// Its near edge on the point: a belt's grows upward, anything else's outward to the side.
			SizeOffset={belt ? new Vector2(0, 0.5) : new Vector2(side * 0.5, 0)}
			StudsOffset={beside}
			StudsOffsetWorldSpace={lift}
		>
			<HudBox
				name="Panel"
				anchorPoint={Vector2.zero}
				position={() => UDim2.fromScale(0, 0)}
				size={UDim2.fromScale(1, 1)}
			>
				<Label
					color={COLORS.text}
					font={FONT_DISPLAY}
					size={new UDim2(1, 0, 0, 16)}
					text={def.name.upper()}
					textSize={14}
				/>
				<frame BackgroundTransparency={1} Position={UDim2.fromOffset(0, 20)} Size={new UDim2(1, 0, 1, -20)}>
					<uilistlayout SortOrder={Enum.SortOrder.LayoutOrder} />
					<Index each={rows}>
						{(row, index) => {
							// A row keeps its ore: the rows only change in number with the planet's resources.
							const resource = row().resource;
							return (
								<frame BackgroundTransparency={1} LayoutOrder={index} Size={new UDim2(1, 0, 0, ROW)}>
									{resource !== undefined ? (
										<Swatch resource={() => row().resource ?? resource} />
									) : undefined}
									<Label
										position={UDim2.fromOffset(resource !== undefined ? 16 : 0, 0)}
										size={UDim2.fromScale(0.5, 1)}
										text={() => row().label}
									/>
									<Label
										alignX={Enum.TextXAlignment.Right}
										anchorPoint={new Vector2(1, 0)}
										color={COLORS.text}
										font={FONT_DISPLAY}
										position={UDim2.fromScale(1, 0)}
										size={UDim2.fromScale(0.5, 1)}
										text={() => row().value}
										textSize={13}
									/>
								</frame>
							);
						}}
					</Index>
					{sorter || belt ? (
						<frame BackgroundTransparency={1} LayoutOrder={100} Size={new UDim2(1, 0, 0, SWATCH + 8)}>
							<uipadding PaddingTop={new UDim(0, 4)} />
							<uilistlayout
								FillDirection={Enum.FillDirection.Horizontal}
								Padding={new UDim(0, GAP)}
								SortOrder={Enum.SortOrder.LayoutOrder}
							/>
							{sorter
								? RESOURCE_ORDER.map((resource, index) => (
										<OreButton
											layoutOrder={index}
											onClick={() => onPick(filter() === resource ? undefined : resource)}
											picked={() => filter() === resource}
											resource={() => resource}
										/>
									))
								: undefined}
							{belt ? (
								<Index each={onBelt}>
									{(stack, index) => (
										<OreButton
											layoutOrder={index}
											onClick={() => onTake(stack().resource)}
											resource={() => stack().resource}
											text={() => tostring(stack().amount)}
										/>
									)}
								</Index>
							) : undefined}
							<Show when={() => belt && onBelt().isEmpty()}>
								{() => <Label size={UDim2.fromScale(1, 1)} text="NOTHING ON IT" />}
							</Show>
						</frame>
					) : undefined}
					{!actions.isEmpty() ? (
						<frame BackgroundTransparency={1} LayoutOrder={101} Size={new UDim2(1, 0, 0, BUTTONS)}>
							<uipadding PaddingTop={new UDim(0, 6)} />
							<uilistlayout
								FillDirection={Enum.FillDirection.Horizontal}
								Padding={new UDim(0, 8)}
								SortOrder={Enum.SortOrder.LayoutOrder}
							/>
							{actions.map(([text, onClick], index) => (
								<Button
									color={COLORS.confirm}
									disabled={() => !near()}
									layoutOrder={index}
									onClick={onClick}
									size={
										new UDim2(
											1 / actions.size(),
											(-8 * (actions.size() - 1)) / actions.size(),
											1,
											0,
										)
									}
									text={() => (near() ? text : "MOVE CLOSER")}
								/>
							))}
						</frame>
					) : undefined}
				</frame>
			</HudBox>
		</billboardgui>
	);
}
