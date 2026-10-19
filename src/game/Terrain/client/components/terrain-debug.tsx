import { HttpService } from "@rbxts/services";
import Vide, { derive, effect, source } from "@rbxts/vide";

import { Button } from "core/Interface/client/components/button";
import { Panel } from "core/Interface/client/components/panel";
import { ScrollList } from "core/Interface/client/components/scroll-list";
import { COLORS, FONT_DISPLAY, FONT_LABEL, LEVEL_COLORS } from "core/Interface/client/theme";
import { Label } from "game/Base/client/components/base-hud";
import { type ConfigField, TERRAIN_FIELDS, TERRAIN_GROUPS } from "game/Terrain/shared/config";
import type { TerrainDebugState } from "game/Terrain/shared/terrain-network";

type Config = Record<string, number | string>;
type NumberField = Extract<ConfigField, { kind: "number" }>;

const ROW_HEIGHT = 26;
/** The largest seed `Random seed` picks: the top of a 32-bit signed integer, less one. */
const MAX_SEED = 2147483646;

function defaults(): Config {
	const config: Config = {};
	for (const field of TERRAIN_FIELDS) config[field.key] = field.default;
	return config;
}

/** The server's config over the defaults, so every field has a value even if the JSON leaves some out. */
function parse(json: string): Config {
	const [ok, decoded] = pcall(() => HttpService.JSONDecode(json));
	return { ...defaults(), ...(ok && typeIs(decoded, "table") ? (decoded as Config) : {}) };
}

/** A typed number clamped to the field's range, and snapped to whole steps from its minimum when the step is 1 or more. */
function sanitize(field: NumberField, text: string): number | undefined {
	const typed = tonumber(text);
	if (typed === undefined || typed !== typed) return undefined;
	let value = math.clamp(typed, field.min, field.max);
	if (field.step >= 1) {
		value = math.clamp(field.min + math.round((value - field.min) / field.step) * field.step, field.min, field.max);
	}
	return value;
}

interface InputProps<F extends ConfigField> {
	readonly field: F;
	readonly value: () => number | string;
	readonly onChange: (value: number | string) => void;
}

/** A square box the value is typed into. It checks the value when focus leaves, and shows what was kept. */
function NumberInput({ field, value, onChange }: InputProps<NumberField>) {
	let box: TextBox | undefined;

	return (
		<textbox
			action={(rbx) => {
				box = rbx;
			}}
			AnchorPoint={new Vector2(1, 0)}
			BackgroundColor3={COLORS.card}
			BackgroundTransparency={0.3}
			BorderSizePixel={0}
			ClearTextOnFocus={false}
			FontFace={FONT_DISPLAY}
			Position={UDim2.fromScale(1, 0)}
			Size={UDim2.fromScale(0.45, 1)}
			Text={() => tostring(value())}
			TextColor3={COLORS.text}
			TextSize={13}
			FocusLost={() => {
				if (!box) return;
				const kept = sanitize(field, box.Text);
				if (kept !== undefined) onChange(kept);
				// The value may not have changed (or the text was not a number), so the binding won't redraw it.
				box.Text = tostring(value());
			}}
		>
			<uistroke
				ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
				Color={COLORS.stroke}
				LineJoinMode={Enum.LineJoinMode.Miter}
				Thickness={1}
			/>
		</textbox>
	);
}

/** A square button showing the option, which steps to the next one on each click. */
function ChoiceInput({ field, value, onChange }: InputProps<Extract<ConfigField, { kind: "choice" }>>) {
	return (
		<textbutton
			AnchorPoint={new Vector2(1, 0)}
			AutoButtonColor={true}
			BackgroundColor3={COLORS.card}
			BackgroundTransparency={0.3}
			BorderSizePixel={0}
			FontFace={FONT_DISPLAY}
			Position={UDim2.fromScale(1, 0)}
			Size={UDim2.fromScale(0.45, 1)}
			Text={() => tostring(value()).upper()}
			TextColor3={COLORS.accent}
			TextSize={13}
			Activated={() => {
				const options = field.options;
				onChange(options[(options.indexOf(tostring(value())) + 1) % options.size()]);
			}}
		>
			<uistroke
				ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
				Color={COLORS.stroke}
				LineJoinMode={Enum.LineJoinMode.Miter}
				Thickness={1}
			/>
		</textbutton>
	);
}

interface GroupProps {
	readonly name: string;
	readonly layoutOrder: number;
	readonly draft: () => Config;
	readonly onChange: (key: string, value: number | string) => void;
}

/** A heading that folds its fields away when clicked, and a row for each field in it. */
function Group({ name, layoutOrder, draft, onChange }: GroupProps) {
	const open = source(true);

	return (
		<frame
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={1}
			LayoutOrder={layoutOrder}
			Size={new UDim2(1, 0, 0, 0)}
		>
			<uilistlayout Padding={new UDim(0, 4)} SortOrder={Enum.SortOrder.LayoutOrder} />
			<textbutton
				AutoButtonColor={false}
				BackgroundColor3={COLORS.cardHover}
				BackgroundTransparency={0.4}
				BorderSizePixel={0}
				FontFace={FONT_DISPLAY}
				LayoutOrder={0}
				Size={new UDim2(1, 0, 0, ROW_HEIGHT)}
				Text={() => `${open() ? "-" : "+"}  ${name.upper()}`}
				TextColor3={COLORS.text}
				TextSize={13}
				TextXAlignment={Enum.TextXAlignment.Left}
				Activated={() => open(!open())}
			>
				<uipadding PaddingLeft={new UDim(0, 8)} />
			</textbutton>
			{TERRAIN_FIELDS.filter((field) => field.group === name).map((field, index) => {
				const value = () => draft()[field.key] ?? field.default;
				const change = (value: number | string) => onChange(field.key, value);
				return (
					<frame
						BackgroundTransparency={1}
						LayoutOrder={index + 1}
						Size={new UDim2(1, 0, 0, ROW_HEIGHT)}
						Visible={open}
					>
						<Label size={new UDim2(0.55, -8, 1, 0)} text={field.label.upper()} textSize={12} />
						{field.kind === "number" ? (
							<NumberInput field={field} value={value} onChange={change} />
						) : (
							<ChoiceInput field={field} value={value} onChange={change} />
						)}
					</frame>
				);
			})}
		</frame>
	);
}

interface TerrainDebugPanelProps {
	readonly state: () => TerrainDebugState;
	readonly onApply: (config: string) => void;
}

/**
 * The terrain generator's settings and how its last run went, on the left. The
 * fields are built from `TERRAIN_FIELDS`, folded into `TERRAIN_GROUPS`. Edits
 * stay a draft, flagged as unapplied, until Apply sends them; Random seed rolls
 * the seed and applies, Revert goes back to the applied config and Defaults
 * fills in every field's default without applying.
 */
export function TerrainDebugPanel({ state, onApply }: TerrainDebugPanelProps) {
	// Derived from the JSON string, so the progress updates in between don't reset the draft.
	const json = derive(() => state().config);
	const applied = derive(() => parse(json()));
	const draft = source<Config>({});
	effect(() => draft(applied()));

	const dirty = () => TERRAIN_FIELDS.some((field) => draft()[field.key] !== applied()[field.key]);
	const apply = (config: Config) => onApply(HttpService.JSONEncode(config));
	const stats = () => {
		const s = state();
		return [
			`PLANET ${s.planet}   EPOCH ${s.epoch}   ${s.generating ? "GENERATING" : "IDLE"}`,
			`CHUNKS ${s.loadedChunks} / ${s.totalChunks}`,
			string.format("BUILD %.2f MS   WRITE %.2f MS", s.buildMs, s.writeMs),
			string.format("LAST RUN %.1f S", s.seconds),
		].join("\n");
	};

	return (
		<frame
			Name="TerrainDebug"
			Active={true}
			AnchorPoint={new Vector2(0, 0.5)}
			BackgroundTransparency={1}
			Position={new UDim2(0, 16, 0.5, 0)}
			Size={new UDim2(0, 340, 0.8, 0)}
		>
			<Panel kind="debug" square={true}>
				<uipadding
					PaddingBottom={new UDim(0, 12)}
					PaddingLeft={new UDim(0, 12)}
					PaddingRight={new UDim(0, 12)}
					PaddingTop={new UDim(0, 10)}
				/>
				<Label
					color={COLORS.text}
					font={FONT_DISPLAY}
					size={new UDim2(1, 0, 0, 20)}
					text="TERRAIN"
					textSize={18}
				/>
				<Label
					alignX={Enum.TextXAlignment.Right}
					anchorPoint={new Vector2(1, 0)}
					position={UDim2.fromScale(1, 0)}
					size={new UDim2(0.5, 0, 0, 20)}
					text="F4 CLOSE"
				/>
				<textlabel
					BackgroundTransparency={1}
					FontFace={FONT_LABEL}
					Position={UDim2.fromOffset(0, 26)}
					Size={new UDim2(1, 0, 0, 64)}
					Text={stats}
					TextColor3={COLORS.muted}
					TextSize={12}
					TextXAlignment={Enum.TextXAlignment.Left}
					TextYAlignment={Enum.TextYAlignment.Top}
				/>
				<Label
					color={LEVEL_COLORS[2]}
					font={FONT_DISPLAY}
					position={UDim2.fromOffset(0, 94)}
					size={new UDim2(1, 0, 0, 16)}
					text={() => (dirty() ? "UNAPPLIED CHANGES" : "")}
				/>
				<ScrollList
					position={UDim2.fromOffset(0, 116)}
					size={new UDim2(1, 0, 1, -116 - 72)}
					gap={6}
					padding={6}
				>
					{TERRAIN_GROUPS.map((name, index) => (
						<Group
							name={name}
							layoutOrder={index}
							draft={draft}
							onChange={(key, value) => draft({ ...draft(), [key]: value })}
						/>
					))}
				</ScrollList>
				<frame
					AnchorPoint={new Vector2(0, 1)}
					BackgroundTransparency={1}
					Position={UDim2.fromScale(0, 1)}
					Size={new UDim2(1, 0, 0, 62)}
				>
					<uigridlayout
						CellPadding={UDim2.fromOffset(8, 6)}
						CellSize={new UDim2(0.5, -4, 0, 28)}
						SortOrder={Enum.SortOrder.LayoutOrder}
					/>
					<Button color={COLORS.confirm} layoutOrder={0} onClick={() => apply(draft())} text="APPLY" />
					<Button
						color={COLORS.accent}
						layoutOrder={1}
						onClick={() => {
							const config = { ...draft(), seed: math.random(0, MAX_SEED) };
							draft(config);
							apply(config);
						}}
						text="RANDOM SEED"
					/>
					<Button color={COLORS.subtext} layoutOrder={2} onClick={() => draft(applied())} text="REVERT" />
					<Button color={COLORS.subtext} layoutOrder={3} onClick={() => draft(defaults())} text="DEFAULTS" />
				</frame>
			</Panel>
		</frame>
	);
}
