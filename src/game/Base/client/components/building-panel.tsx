import { Workspace } from "@rbxts/services";
import Vide, { cleanup, Index, Show, source } from "@rbxts/vide";

import { Button } from "core/Interface/client/components/button";
import { COLORS, FONT_DISPLAY } from "core/Interface/client/theme";
import { HudBox, Label, Swatch } from "game/Base/client/components/base-hud";
import { InfoButton } from "game/Base/client/components/turret-info";
import { BLASTERS, type BlasterKind } from "game/Base/shared/blasters";
import { BUILDINGS, type BuildingKind, isCore, MACHINE_SECONDS } from "game/Base/shared/buildings";
import { RESOURCE_ORDER, RESOURCES, type ResourceId, type ResourceStack } from "game/Base/shared/resources";
import { CELL_STUDS } from "game/Terrain/shared/map";

const WIDTH = 260;
const ROW = 18;
const SWATCH = 24;
/** Between swatches. A row fits this many; an ore picker wraps onto more rows. */
const GAP = 2;
const PER_ROW = 9;
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
	/** Sorters, sources and unloaders: the ore to let through, hand out or take now, or undefined for none (any, for an unloader). */
	readonly onPick: (resource: ResourceId | undefined) => void;
	/** Belts: the ore on it, and taking all of one ore off it. */
	readonly ore: () => ReadonlyArray<ResourceId>;
	readonly onTake: (resource: ResourceId) => void;
	/** Turrets: opens the info page (see `TurretInfo`). */
	readonly onInfo: () => void;
	/** The Core: the Blasters its tier lets players pick, the one the local player carries, and picking another. */
	readonly blasters: () => ReadonlyArray<BlasterKind>;
	readonly blaster: () => BlasterKind;
	readonly onBlaster: (kind: BlasterKind) => void;
}

/** What a Blaster does, in a row's few characters. */
function blasterText(kind: BlasterKind): string {
	const { damage, seconds, volley, pierce, splash, chain, repair } = BLASTERS[kind];
	let text = `${damage}${volley !== undefined ? ` ×${volley}` : ""} DMG · ${math.round(10 / seconds) / 10}/S`;
	if (pierce !== undefined) text += " · PIERCES";
	if (splash !== undefined) text += " · AREA";
	if (chain !== undefined) text += " · CHAINS";
	if (repair !== undefined) text += " · REPAIRS";
	return text;
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
			// Over its neighbours, so the gap doesn't hide its thick outline.
			ZIndex={() => (picked() ? 2 : 1)}
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
 * clicking the outlined one lets nothing through. A Source's picks the ore it hands out, and an
 * Unloader's the ore it takes, the same way. A belt's has a swatch for each ore on it, with its
 * count: clicking one takes all of that ore. Storage lists what it holds; what's on the power
 * network shows its power. A turret's has a ? button in its corner, which opens its info page. The
 * Core's has a button for each Blaster its tier lets players pick, the local player's outlined. It
 * has to live in PlayerGui, not on the building, to take clicks.
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
	onInfo,
	blasters,
	blaster,
	onBlaster,
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
	const belt = def.belt !== undefined;
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
			const { inputs, output, storage } = def.craft;
			list.push({ label: "RATE", value: `1 / ${MACHINE_SECONDS}s` });
			for (const { resource, amount } of inputs) {
				list.push({
					label: `${RESOURCES[resource].name.upper()} x${amount}`,
					value: `${read(`Input_${resource}`)} / ${storage}`,
					resource,
				});
			}
			list.push({
				label: RESOURCES[output].name.upper(),
				value: `${read("Stored")} / ${storage}`,
				resource: output,
			});
		}
		if (kind === "source") {
			const output = filter();
			list.push({ label: "OUTPUT", value: output !== undefined ? RESOURCES[output].name.upper() : "NONE" });
		}
		if (def.turret) {
			if (!def.turret.energy) {
				list.push({ label: "AMMO", value: `${read("Ammo")} / ${def.turret.maxAmmo}` });
				// No swatch: rows keep theirs from when they're made, and this one's ore comes and goes.
				const firing = attributes().get("AmmoType") as ResourceId | undefined;
				list.push({ label: "FIRING", value: firing !== undefined ? RESOURCES[firing].name.upper() : "NONE" });
			}
			list.push({ label: "TARGETS", value: def.turret.targets?.upper() ?? "AIR + GROUND" });
		}
		if (def.power !== undefined) {
			list.push({ label: "POWER", value: `${math.round(read("Power") * 100)}%` });
			list.push({ label: "USES", value: `${def.power} / s` });
		}
		const generator = def.generator;
		if (generator) {
			list.push({ label: "OUTPUT", value: `${read("PowerOut")} / s` });
			for (const resource of RESOURCE_ORDER) {
				if (generator.fuel?.[resource] === undefined) continue;
				const fuel = `${read(`Input_${resource}`)} / ${generator.storage ?? 0}`;
				list.push({ label: RESOURCES[resource].name.upper(), value: fuel, resource });
			}
		}
		if (def.battery !== undefined) list.push({ label: "CHARGE", value: `${read("Charge")} / ${def.battery}` });
		if (def.node !== undefined) {
			list.push(
				{ label: "LINKS", value: `${read("Links")} / ${def.node}` },
				{ label: "MAKING", value: `${read("Produced")} / s` },
				{ label: "USING", value: `${read("Demand")} / s` },
				{ label: "STORED", value: tostring(read("Stored")) },
			);
		}
		if (kind === "unloader") {
			const picked = filter();
			list.push({ label: "TAKES", value: picked !== undefined ? RESOURCES[picked].name.upper() : "ANY" });
		}
		if (def.store !== undefined) {
			list.push({ label: "HOLDS", value: `${def.store} OF EACH` });
			for (const resource of RESOURCE_ORDER) {
				const held = read(`Input_${resource}`);
				if (held > 0) list.push({ label: RESOURCES[resource].name.upper(), value: tostring(held), resource });
			}
		}
		if (def.repair !== undefined) list.push({ label: "REPAIRS", value: `${def.repair} / ${MACHINE_SECONDS}s` });
		if (def.range !== undefined) list.push({ label: "RANGE", value: `${def.range}` });
		if (isCore(kind)) {
			list.push({ label: BLASTERS[blaster()].name.upper(), value: blasterText(blaster()) });
			for (const { resource, amount } of pool()) {
				list.push({ label: RESOURCES[resource].name.upper(), value: `${amount} / ${capacity()}`, resource });
			}
		}
		return list;
	};

	const actions = new Array<[text: string, onClick: () => void]>();
	if (isCore(kind)) actions.push(["DEPOSIT ALL", onLoad]);
	if (def.turret && !def.turret.energy) actions.push(["LOAD AMMO", onLoad]);
	if (def.generator?.fuel) actions.push(["LOAD FUEL", onLoad]);
	if (def.store !== undefined) actions.push(["STORE ALL", onLoad]);
	if (def.craft) {
		const { inputs } = def.craft;
		actions.push([
			inputs.size() > 1 ? "LOAD INPUTS" : `LOAD ${RESOURCES[inputs[0].resource].name.upper()}`,
			onLoad,
		]);
	}
	if (def.drill || def.craft || belt || def.store !== undefined) actions.push(["COLLECT ALL", onCollect]);
	// Sorters, sources and unloaders pick an ore.
	const sorter = kind === "sorter" || kind === "source" || kind === "unloader";
	// Below the rows: the swatches (a belt's in one row), then the buttons.
	const swatches = sorter ? math.ceil(RESOURCE_ORDER.size() / PER_ROW) * (SWATCH + GAP) + 6 : belt ? SWATCH + 8 : 0;
	// The Core's Blasters, two to a row.
	const picker = () => (isCore(kind) ? math.ceil(blasters().size() / 2) * (SWATCH + GAP) + 6 : 0);
	const extra = () => swatches + picker() + (actions.isEmpty() ? 0 : BUTTONS);
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
			Size={() => UDim2.fromOffset(WIDTH, CHROME + ROW * rows().size() + extra())}
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
				{def.turret ? <InfoButton position={UDim2.fromScale(1, 0)} onClick={onInfo} /> : undefined}
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
						<frame BackgroundTransparency={1} LayoutOrder={100} Size={new UDim2(1, 0, 0, swatches)}>
							<uipadding PaddingTop={new UDim(0, 4)} />
							{sorter ? (
								<uigridlayout
									CellPadding={UDim2.fromOffset(GAP, GAP)}
									CellSize={UDim2.fromOffset(SWATCH, SWATCH)}
									SortOrder={Enum.SortOrder.LayoutOrder}
								/>
							) : (
								<uilistlayout
									FillDirection={Enum.FillDirection.Horizontal}
									Padding={new UDim(0, GAP)}
									SortOrder={Enum.SortOrder.LayoutOrder}
								/>
							)}
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
					{isCore(kind) ? (
						<frame BackgroundTransparency={1} LayoutOrder={100} Size={() => new UDim2(1, 0, 0, picker())}>
							<uipadding PaddingTop={new UDim(0, 4)} />
							<uigridlayout
								CellPadding={UDim2.fromOffset(GAP, GAP)}
								CellSize={new UDim2(0.5, -GAP / 2, 0, SWATCH)}
								SortOrder={Enum.SortOrder.LayoutOrder}
							/>
							<Index each={blasters}>
								{(each, index) => (
									<textbutton
										AutoButtonColor={true}
										BackgroundColor3={() => BLASTERS[each()].color.Lerp(new Color3(), 0.55)}
										BorderSizePixel={0}
										FontFace={FONT_DISPLAY}
										LayoutOrder={index}
										Text={() => BLASTERS[each()].name.upper()}
										TextColor3={() => (near() ? COLORS.text : COLORS.muted)}
										TextSize={12}
										ZIndex={() => (blaster() === each() ? 2 : 1)}
										Activated={() => near() && onBlaster(each())}
									>
										<uistroke
											ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
											Color={() => (blaster() === each() ? COLORS.text : COLORS.stroke)}
											LineJoinMode={Enum.LineJoinMode.Miter}
											Thickness={() => (blaster() === each() ? 2.5 : 1)}
										/>
									</textbutton>
								)}
							</Index>
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
