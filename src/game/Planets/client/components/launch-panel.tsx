import Vide, { Index, source } from "@rbxts/vide";

import { Button } from "core/Interface/client/components/button";
import { useAppear, useScramble } from "core/Interface/client/motion";
import { COLORS, FONT_DISPLAY } from "core/Interface/client/theme";
import type { Planet } from "core/Worlds/shared/star-system";
import { amountOf, canAfford } from "game/Base/client/base-state";
import { HudBox, Label, Swatch } from "game/Base/client/components/base-hud";
import { type ResourceId, RESOURCES, type ResourceStack, travelCost } from "game/Base/shared/resources";
import type { LaunchPlan } from "game/Planets/shared/planets-network";

const WIDTH = 280;
const ROW = 18;
/** Cargo added or taken per click. */
const STEP = 10;
/** Pixels between the panel and the right edge, and below the top of the screen. */
const EDGE = 16;
const TOP = 0.3;

/** The heading, the button row and the padding round them: what a panel takes before its rows. */
const CHROME = 104;

interface StackRowsProps {
	readonly title: string;
	readonly stacks: () => ReadonlyArray<ResourceStack>;
	/** Red while this is false for a stack. */
	readonly ok?: (stack: ResourceStack) => boolean;
	readonly layoutOrder: number;
}

/** A small heading and a line for each stack: swatch, name and amount. */
function StackRows({ title, stacks, ok = () => true, layoutOrder }: StackRowsProps) {
	return (
		<frame
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={1}
			LayoutOrder={layoutOrder}
			Size={new UDim2(1, 0, 0, 0)}
		>
			<uilistlayout SortOrder={Enum.SortOrder.LayoutOrder} />
			<Label color={COLORS.subtext} size={new UDim2(1, 0, 0, ROW)} text={title} textSize={11} />
			<Index each={stacks}>
				{(stack, index) => (
					<frame BackgroundTransparency={1} LayoutOrder={index} Size={new UDim2(1, 0, 0, ROW)}>
						<Swatch resource={() => stack().resource} />
						<Label
							position={UDim2.fromOffset(16, 0)}
							size={new UDim2(0.6, -16, 1, 0)}
							text={() => RESOURCES[stack().resource].name.upper()}
						/>
						<Label
							alignX={Enum.TextXAlignment.Right}
							anchorPoint={new Vector2(1, 0)}
							color={() => (ok(stack()) ? COLORS.text : COLORS.danger)}
							font={FONT_DISPLAY}
							position={UDim2.fromScale(1, 0)}
							size={UDim2.fromScale(0.4, 1)}
							text={() => tostring(stack().amount)}
							textSize={14}
						/>
					</frame>
				)}
			</Index>
		</frame>
	);
}

/** Two buttons side by side along the bottom of a panel. */
function ButtonRow({ children }: { readonly children: Vide.Node }) {
	return (
		<frame
			AnchorPoint={new Vector2(0, 1)}
			BackgroundTransparency={1}
			Position={UDim2.fromScale(0, 1)}
			Size={new UDim2(1, 0, 0, 30)}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				Padding={new UDim(0, 8)}
				SortOrder={Enum.SortOrder.LayoutOrder}
			/>
			{children}
		</frame>
	);
}

interface LoadoutPanelProps {
	readonly planets: ReadonlyArray<Planet>;
	readonly destination: () => number;
	/** The Core's pool on this planet. */
	readonly pool: () => ReadonlyArray<ResourceStack>;
	readonly onLaunch: (cargo: Array<ResourceStack>) => void;
	readonly onBack: () => void;
	readonly show: () => boolean;
}

/**
 * Setting up a launch: the fuel it burns (red where the Core is short) and a
 * stepper for each resource to load as cargo, up to what's left after the fuel.
 * LAUNCH proposes it to the team. Slides in from the right.
 */
export function LoadoutPanel({ planets, destination, pool, onLaunch, onBack, show }: LoadoutPanelProps) {
	const slide = useAppear(show, 0.05);
	const cargo = source<Partial<Record<ResourceId, number>>>({});
	const fuel = () => travelCost(planets, destination());
	/** Most of `resource` that fits as cargo: the pool, less the fuel. */
	const spare = (resource: ResourceId) => math.max(amountOf(pool(), resource) - amountOf(fuel(), resource), 0);
	const loaded = (resource: ResourceId) => math.min(cargo()[resource] ?? 0, spare(resource));
	const step = (resource: ResourceId, by: number) =>
		cargo({ ...cargo(), [resource]: math.clamp(loaded(resource) + by, 0, spare(resource)) });
	const title = useScramble("hud", () => `LAUNCH TO ${planets[destination()].name.upper()}`, 0.1);

	return (
		<HudBox
			name="LoadoutPanel"
			anchorPoint={new Vector2(1, 0)}
			position={() => new UDim2(1, -EDGE + 320 * (1 - slide()), TOP, 0)}
			size={() => UDim2.fromOffset(WIDTH, CHROME + ROW * (fuel().size() + pool().size() + 2))}
		>
			<Label color={COLORS.text} font={FONT_DISPLAY} size={new UDim2(1, 0, 0, 20)} text={title} textSize={15} />
			<frame BackgroundTransparency={1} Position={UDim2.fromOffset(0, 26)} Size={new UDim2(1, 0, 1, -64)}>
				<uilistlayout Padding={new UDim(0, 4)} SortOrder={Enum.SortOrder.LayoutOrder} />
				<StackRows
					layoutOrder={0}
					ok={(stack) => amountOf(pool(), stack.resource) >= stack.amount}
					stacks={fuel}
					title="FUEL"
				/>
				<Label
					color={COLORS.subtext}
					layoutOrder={1}
					size={new UDim2(1, 0, 0, ROW)}
					text="CARGO"
					textSize={11}
				/>
				<Index each={pool}>
					{(stack, index) => (
						<frame BackgroundTransparency={1} LayoutOrder={2 + index} Size={new UDim2(1, 0, 0, ROW)}>
							<Swatch resource={() => stack().resource} />
							<Label
								position={UDim2.fromOffset(16, 0)}
								size={new UDim2(0.5, -16, 1, 0)}
								text={() => RESOURCES[stack().resource].name.upper()}
							/>
							<Button
								anchorPoint={new Vector2(1, 0)}
								color={COLORS.stroke}
								onClick={() => step(stack().resource, -STEP)}
								position={new UDim2(1, -70, 0, 0)}
								size={UDim2.fromOffset(ROW, ROW)}
								text="-"
							/>
							<Label
								alignX={Enum.TextXAlignment.Center}
								anchorPoint={new Vector2(1, 0)}
								color={COLORS.text}
								font={FONT_DISPLAY}
								position={new UDim2(1, -22, 0, 0)}
								size={UDim2.fromOffset(44, ROW)}
								text={() => tostring(loaded(stack().resource))}
								textSize={14}
							/>
							<Button
								anchorPoint={new Vector2(1, 0)}
								color={COLORS.stroke}
								onClick={() => step(stack().resource, STEP)}
								position={UDim2.fromScale(1, 0)}
								size={UDim2.fromOffset(ROW, ROW)}
								text="+"
							/>
						</frame>
					)}
				</Index>
			</frame>
			<ButtonRow>
				<Button
					color={COLORS.confirm}
					disabled={() => !canAfford(pool(), fuel())}
					layoutOrder={0}
					onClick={() => {
						const stacks = new Array<ResourceStack>();
						for (const { resource } of pool()) {
							const amount = loaded(resource);
							if (amount > 0) stacks.push({ resource, amount });
						}
						onLaunch(stacks);
					}}
					size={new UDim2(0.5, -4, 1, 0)}
					text="LAUNCH"
				/>
				<Button
					color={COLORS.stroke}
					layoutOrder={1}
					onClick={onBack}
					size={new UDim2(0.5, -4, 1, 0)}
					text="BACK"
				/>
			</ButtonRow>
		</HudBox>
	);
}

interface PlanPanelProps {
	readonly planets: ReadonlyArray<Planet>;
	readonly plan: () => LaunchPlan;
	/** The local player's UserId. */
	readonly userId: number;
	readonly onReady: () => void;
	readonly onCancel: () => void;
	readonly show: () => boolean;
}

/**
 * A launch someone has set up, for everyone on the planet: where to, what it
 * carries (or, for a retreat, that the base here is lost), how many are ready,
 * and READY and CANCEL. It goes once everyone is. Slides in from the right.
 */
export function PlanPanel({ planets, plan, userId, onReady, onCancel, show }: PlanPanelProps) {
	const slide = useAppear(show, 0.05);
	// A plan never changes kind: it is called off before another is set up, and the Show remounts this for it.
	const abandon = plan().abandon;
	const title = useScramble(
		"hud",
		() => `${abandon ? "RETREAT" : "LAUNCH"} TO ${planets[plan().planet].name.upper()}`,
		0.1,
	);
	const isReady = () => plan().ready.includes(userId);
	const rows = () => (abandon ? 2 : 1 + plan().cargo.size());

	return (
		<HudBox
			name="PlanPanel"
			anchorPoint={new Vector2(1, 0)}
			position={() => new UDim2(1, -EDGE + 320 * (1 - slide()), TOP, 0)}
			size={() => UDim2.fromOffset(WIDTH, CHROME + ROW * (rows() + 1))}
		>
			<Label color={COLORS.text} font={FONT_DISPLAY} size={new UDim2(1, 0, 0, 20)} text={title} textSize={15} />
			<frame BackgroundTransparency={1} Position={UDim2.fromOffset(0, 26)} Size={new UDim2(1, 0, 1, -64)}>
				<uilistlayout Padding={new UDim(0, 4)} SortOrder={Enum.SortOrder.LayoutOrder} />
				{abandon ? (
					<Label
						color={COLORS.danger}
						layoutOrder={0}
						size={new UDim2(1, 0, 0, ROW * 2)}
						text="ENEMIES HOLD THIS PLANET. THE CORE AND BASE HERE WILL BE LOST."
						wrapped={true}
					/>
				) : (
					<StackRows layoutOrder={0} stacks={() => plan().cargo} title="CARGO" />
				)}
				<Label
					color={COLORS.accent}
					font={FONT_DISPLAY}
					layoutOrder={1}
					size={new UDim2(1, 0, 0, ROW)}
					text={() => `READY ${plan().ready.size()} / ${plan().needed.size()}`}
					textSize={14}
				/>
			</frame>
			<ButtonRow>
				<Button
					color={COLORS.confirm}
					disabled={isReady}
					layoutOrder={0}
					onClick={onReady}
					size={new UDim2(0.5, -4, 1, 0)}
					text={() => (isReady() ? "WAITING..." : "READY")}
				/>
				<Button
					color={COLORS.danger}
					layoutOrder={1}
					onClick={onCancel}
					size={new UDim2(0.5, -4, 1, 0)}
					text="CANCEL"
				/>
			</ButtonRow>
		</HudBox>
	);
}

interface TravelOverlayProps {
	readonly destination: () => string;
	readonly show: () => boolean;
}

/** Black over the screen while the next planet generates, with where the core is headed. Fades in and out. */
export function TravelOverlay({ destination, show }: TravelOverlayProps) {
	const fade = useAppear(show);
	const text = useScramble("banner", () => `EN ROUTE TO ${destination().upper()}`, 0.2, 0.6);

	return (
		<frame
			Name="TravelOverlay"
			BackgroundColor3={new Color3()}
			BackgroundTransparency={() => 1 - math.clamp(fade(), 0, 1)}
			BorderSizePixel={0}
			Size={UDim2.fromScale(1, 1)}
			ZIndex={20}
		>
			<textlabel
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				FontFace={FONT_DISPLAY}
				Position={UDim2.fromScale(0.5, 0.5)}
				Size={UDim2.fromOffset(700, 40)}
				Text={text}
				TextColor3={COLORS.text}
				TextScaled={true}
				TextTransparency={() => 1 - math.clamp(fade(), 0, 1)}
				ZIndex={21}
			/>
		</frame>
	);
}
