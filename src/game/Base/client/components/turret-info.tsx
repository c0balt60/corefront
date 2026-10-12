import Vide from "@rbxts/vide";

import { Button } from "core/Interface/client/components/button";
import { useAppear } from "core/Interface/client/motion";
import { COLORS, FONT, FONT_DISPLAY } from "core/Interface/client/theme";
import { HudBox, Label, Swatch } from "game/Base/client/components/base-hud";
import { type BuildableKind, BUILDINGS, type EnergyDef, type TurretDef } from "game/Base/shared/buildings";
import { RESOURCE_ORDER, RESOURCES, type ResourceId, type ResourceStack } from "game/Base/shared/resources";
import { Glyph } from "game/Research/client/components/glyphs";

const WIDTH = 460;
const HEADER = 52;
const FOOTER = 46;
const ROW = 20;
const ICON = 40;

const PROJECTILES: Record<TurretDef["projectile"], string> = {
	bullet: "Bullet",
	flame: "Flame",
	rocket: "Rocket, curving into its target",
	shell: "Shell, lobbed high",
	flak: "Flak, bursting in the air",
	laser: "Laser, burning through all in its path",
	arc: "Lightning, leaping between aliens",
};

/** One line of the page. */
type Line =
	| { readonly heading: string }
	| { readonly text: string }
	| { readonly label: string; readonly value: string }
	| { readonly label: string; readonly cost: ReadonlyArray<ResourceStack> }
	| { readonly resource?: ResourceId; readonly ammo: EnergyDef; readonly shots?: number };

/** Up to one decimal place. */
function round(value: number): string {
	return tostring(math.round(value * 10) / 10);
}

/** Green for a change that helps the turret, red for one that hurts it. */
const tone = (change: number) => (change >= 0 ? COLORS.confirm : COLORS.danger);

/**
 * What an ammo does, Mindustry style, a line each: "18 damage", "x4 shots per item", "+16 range",
 * "-20% fire rate". Its base stats in grey, what it changes green or red. Power has no `shots`.
 */
function ammoStats(ammo: EnergyDef, shots?: number): Array<[text: string, color: Color3]> {
	const stats: Array<[string, Color3]> = [[`${ammo.damage} damage`, COLORS.muted]];
	if (shots !== undefined) stats.push([`x${shots} shots per item`, COLORS.muted]);
	if (ammo.rate !== undefined) {
		const change = math.round((ammo.rate - 1) * 100);
		stats.push([`${change > 0 ? "+" : ""}${change}% fire rate`, tone(change)]);
	}
	if (ammo.range !== undefined) stats.push([`${ammo.range > 0 ? "+" : ""}${ammo.range} range`, tone(ammo.range)]);
	if (ammo.splash !== undefined) stats.push([`${ammo.splash} splash radius`, COLORS.confirm]);
	if (ammo.homing) stats.push(["Homing: never misses", COLORS.confirm]);
	if (ammo.pierce !== undefined) stats.push([`Pierces ${ammo.pierce} aliens`, COLORS.confirm]);
	if (ammo.chain !== undefined) stats.push([`Leaps on to ${ammo.chain} more aliens`, COLORS.confirm]);
	return stats;
}

/** The page for building `kind`, top to bottom: what it's for, its general stats, how it fires, and its ammo. */
function lines(kind: BuildableKind): Array<Line> {
	const def = BUILDINGS[kind];
	const list: Array<Line> = [
		{ heading: "PURPOSE" },
		{ text: def.description },
		{ heading: "GENERAL" },
		{ label: "Health", value: tostring(def.health) },
		{ label: "Size", value: `${def.size}×${def.size}` },
		{ label: "Build cost", cost: def.cost },
	];
	const gun = def.turret;
	if (!gun) return list;
	const burst = gun.burst ?? 1;
	// A burst's shots, over the reload and the gaps between them.
	const perSecond = burst / (gun.seconds + (burst - 1) * (gun.gap ?? 0.4));
	list.push(
		{ heading: "FUNCTION" },
		{ label: "Range", value: `${def.range ?? 0} studs` },
		{ label: "Fire rate", value: `${round(perSecond)} shots / s` },
		{
			label: "Targets",
			value: gun.targets === "air" ? "Air only" : gun.targets === "ground" ? "Ground only" : "Air + Ground",
		},
		{ label: "Picks", value: gun.strongest ? "Toughest in range" : "Nearest in range" },
		{ label: "Projectile", value: PROJECTILES[gun.projectile] },
	);
	if (gun.speed !== undefined) list.push({ label: "Projectile speed", value: `${gun.speed} studs / s` });
	if (gun.volley !== undefined) list.push({ label: "Projectiles per shot", value: tostring(gun.volley) });
	if (gun.fan !== undefined) list.push({ label: "Fanned", value: `${gun.fan}° apart` });
	if (gun.spread !== undefined) list.push({ label: "Inaccuracy", value: `up to ${gun.spread} studs off` });
	if (gun.burst !== undefined) list.push({ label: "Burst", value: `${gun.burst} shots, then reloads` });
	if (gun.spinUp !== undefined) list.push({ label: "Spin-up", value: `${gun.spinUp}s to full rate` });
	if (gun.energy) {
		list.push({ label: "Power use", value: `${def.power ?? 0} / s firing` }, { heading: "POWER" });
		list.push({ ammo: gun.energy });
		return list;
	}
	list.push({ label: "Ammo capacity", value: `${gun.maxAmmo} shots` }, { heading: "AMMO" });
	for (const resource of RESOURCE_ORDER) {
		const ammo = gun.ammo[resource];
		if (ammo) list.push({ resource, ammo, shots: ammo.shots });
	}
	return list;
}

/** A section heading: accent type over a thin accent rule. */
function Heading({ text, layoutOrder }: { readonly text: string; readonly layoutOrder: number }) {
	return (
		<frame BackgroundTransparency={1} LayoutOrder={layoutOrder} Size={new UDim2(1, 0, 0, 28)}>
			<Label
				color={COLORS.accent}
				font={FONT_DISPLAY}
				position={UDim2.fromOffset(0, 8)}
				size={new UDim2(1, 0, 0, 16)}
				text={text}
				textSize={14}
			/>
			<frame
				BackgroundColor3={COLORS.accent}
				BackgroundTransparency={0.5}
				BorderSizePixel={0}
				Position={new UDim2(0, 0, 1, -1)}
				Size={new UDim2(1, 0, 0, 1)}
			/>
		</frame>
	);
}

/** Wrapping body text, as tall as it needs. */
function Text({ text, layoutOrder }: { readonly text: string; readonly layoutOrder: number }) {
	return (
		<textlabel
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={1}
			FontFace={FONT}
			LayoutOrder={layoutOrder}
			Size={UDim2.fromScale(1, 0)}
			Text={text}
			TextColor3={COLORS.text}
			TextSize={15}
			TextWrapped={true}
			TextXAlignment={Enum.TextXAlignment.Left}
		/>
	);
}

/** A label on the left and its value on the right, or a row of resource swatches and amounts. */
function Stat({ label, layoutOrder, children }: { label: string; layoutOrder: number; children: Vide.Node }) {
	return (
		<frame BackgroundTransparency={1} LayoutOrder={layoutOrder} Size={new UDim2(1, 0, 0, ROW)}>
			<Label size={UDim2.fromScale(0.45, 1)} text={label} />
			<frame
				AnchorPoint={new Vector2(1, 0)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(1, 0)}
				Size={UDim2.fromScale(0.55, 1)}
			>
				{children}
			</frame>
		</frame>
	);
}

function Value({ text }: { readonly text: string }) {
	return (
		<Label
			alignX={Enum.TextXAlignment.Right}
			color={COLORS.text}
			font={FONT_DISPLAY}
			size={UDim2.fromScale(1, 1)}
			text={text}
			textSize={13}
		/>
	);
}

interface AmmoProps {
	/** None for a power turret's shots. */
	readonly resource?: ResourceId;
	readonly ammo: EnergyDef;
	readonly shots?: number;
	readonly layoutOrder: number;
}

/** An ammo (or power): its swatch and name, and under them what it does, a line each. */
function Ammo({ resource, ammo, shots, layoutOrder }: AmmoProps) {
	return (
		<frame
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={1}
			LayoutOrder={layoutOrder}
			Size={UDim2.fromScale(1, 0)}
		>
			<uilistlayout SortOrder={Enum.SortOrder.LayoutOrder} />
			<uipadding PaddingTop={new UDim(0, 4)} />
			<frame BackgroundTransparency={1} LayoutOrder={0} Size={new UDim2(1, 0, 0, ROW)}>
				{resource !== undefined ? <Swatch resource={() => resource} /> : undefined}
				<Label
					color={COLORS.text}
					font={FONT_DISPLAY}
					position={UDim2.fromOffset(resource !== undefined ? 16 : 0, 0)}
					size={new UDim2(1, -16, 1, 0)}
					text={resource !== undefined ? RESOURCES[resource].name.upper() : "POWER"}
					textSize={13}
				/>
			</frame>
			{ammoStats(ammo, shots).map(([stat, color], index) => (
				<frame BackgroundTransparency={1} LayoutOrder={index + 1} Size={new UDim2(1, 0, 0, ROW - 2)}>
					<frame
						AnchorPoint={new Vector2(0, 0.5)}
						BackgroundColor3={COLORS.accent}
						BorderSizePixel={0}
						Position={new UDim2(0, 18, 0.5, 0)}
						Size={UDim2.fromOffset(4, 4)}
					/>
					<Label
						color={color}
						position={UDim2.fromOffset(30, 0)}
						size={new UDim2(1, -30, 1, 0)}
						text={stat}
					/>
				</frame>
			))}
		</frame>
	);
}

/** The small ? that opens a turret's info page, in the corner of its panel or the build menu's header. */
export function InfoButton({ position, visible, onClick }: InfoButtonProps) {
	return (
		<textbutton
			AnchorPoint={new Vector2(1, 0)}
			BackgroundColor3={COLORS.stroke}
			BorderSizePixel={0}
			FontFace={FONT_DISPLAY}
			Position={position}
			Size={UDim2.fromOffset(16, 16)}
			Text="?"
			TextColor3={COLORS.text}
			TextSize={12}
			Visible={visible ?? true}
			Activated={onClick}
		/>
	);
}

interface InfoButtonProps {
	/** Of its top right corner. */
	readonly position: UDim2;
	readonly visible?: () => boolean;
	readonly onClick: () => void;
}

interface TurretInfoProps {
	readonly kind: BuildableKind;
	readonly onClose: () => void;
	/** Turns false to fade it away. Return `$tuple(node, EXIT_TIME)` from the Show that renders it. */
	readonly show: () => boolean;
}

/**
 * A turret's info page, opened from the ? on its panel or the build menu, like Mindustry's: over a dimmed screen, its
 * icon and name, then what it's for, its health, size and cost, how it fires, and every ore it takes
 * as ammo with what each does. Clicking outside it or BACK closes it.
 */
export function TurretInfo({ kind, onClose, show }: TurretInfoProps) {
	const def = BUILDINGS[kind];
	const appear = useAppear(show);
	return (
		<textbutton
			AutoButtonColor={false}
			BackgroundColor3={COLORS.card}
			BackgroundTransparency={() => 1 - 0.5 * appear()}
			Size={UDim2.fromScale(1, 1)}
			Text=""
			Activated={onClose}
		>
			<HudBox
				name="TurretInfo"
				anchorPoint={new Vector2(0.5, 0.5)}
				position={() => new UDim2(0.5, 0, 0.5, 24 * (1 - appear()))}
				size={new UDim2(0, WIDTH, 0.8, 0)}
			>
				<frame BackgroundColor3={COLORS.backdrop} BorderSizePixel={0} Size={UDim2.fromOffset(ICON, ICON)}>
					<uipadding
						PaddingBottom={new UDim(0, 4)}
						PaddingLeft={new UDim(0, 4)}
						PaddingRight={new UDim(0, 4)}
						PaddingTop={new UDim(0, 4)}
					/>
					<Glyph glyph={kind} color={COLORS.text} background={COLORS.backdrop} />
				</frame>
				<Label
					color={COLORS.text}
					font={FONT_DISPLAY}
					position={UDim2.fromOffset(ICON + 12, 2)}
					size={new UDim2(1, -ICON - 12, 0, 22)}
					text={def.name.upper()}
					textSize={20}
				/>
				<Label
					position={UDim2.fromOffset(ICON + 12, 24)}
					size={new UDim2(1, -ICON - 12, 0, 16)}
					text={def.turret ? `TURRET  ·  ${def.size}×${def.size}` : `${def.size}×${def.size}`}
				/>
				<scrollingframe
					AutomaticCanvasSize={Enum.AutomaticSize.Y}
					BackgroundTransparency={1}
					BorderSizePixel={0}
					CanvasSize={new UDim2()}
					Position={UDim2.fromOffset(0, HEADER)}
					ScrollBarImageColor3={COLORS.muted}
					ScrollBarThickness={4}
					ScrollingDirection={Enum.ScrollingDirection.Y}
					Size={new UDim2(1, 0, 1, -HEADER - FOOTER)}
				>
					<uilistlayout Padding={new UDim(0, 2)} SortOrder={Enum.SortOrder.LayoutOrder} />
					<uipadding PaddingRight={new UDim(0, 10)} PaddingBottom={new UDim(0, 8)} />
					{lines(kind).map((line, index) => {
						if ("heading" in line) return <Heading text={line.heading} layoutOrder={index} />;
						if ("text" in line) return <Text text={line.text} layoutOrder={index} />;
						if ("ammo" in line)
							return (
								<Ammo
									resource={line.resource}
									ammo={line.ammo}
									shots={line.shots}
									layoutOrder={index}
								/>
							);
						if ("value" in line) {
							return (
								<Stat label={line.label} layoutOrder={index}>
									<Value text={line.value} />
								</Stat>
							);
						}
						return (
							<Stat label={line.label} layoutOrder={index}>
								<uilistlayout
									FillDirection={Enum.FillDirection.Horizontal}
									HorizontalAlignment={Enum.HorizontalAlignment.Right}
									Padding={new UDim(0, 10)}
									SortOrder={Enum.SortOrder.LayoutOrder}
									VerticalAlignment={Enum.VerticalAlignment.Center}
								/>
								{line.cost.map(({ resource, amount }, order) => (
									<frame
										AutomaticSize={Enum.AutomaticSize.X}
										BackgroundTransparency={1}
										LayoutOrder={order}
										Size={UDim2.fromScale(0, 1)}
									>
										<Swatch resource={() => resource} />
										<Label
											color={COLORS.text}
											font={FONT_DISPLAY}
											position={UDim2.fromOffset(14, 0)}
											size={UDim2.fromOffset(36, ROW)}
											text={tostring(amount)}
										/>
									</frame>
								))}
							</Stat>
						);
					})}
				</scrollingframe>
				<Button
					anchorPoint={new Vector2(0.5, 1)}
					color={COLORS.stroke}
					onClick={onClose}
					position={UDim2.fromScale(0.5, 1)}
					size={UDim2.fromOffset(160, 36)}
					text="BACK"
				/>
			</HudBox>
		</textbutton>
	);
}
