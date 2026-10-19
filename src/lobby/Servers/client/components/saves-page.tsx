import Vide, { derive, effect, Show, source } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Button } from "core/Interface/client/components/button";
import { Modal, Panel } from "core/Interface/client/components/panel";
import { EXIT_TIME, useScramble } from "core/Interface/client/motion";
import { COLORS, FONT, FONT_DISPLAY, FONT_LABEL, LEVEL_COLORS, SPRINGS } from "core/Interface/client/theme";
import { generateStarSystem, LEVEL_NAMES, summarizeStarSystem } from "core/Worlds/shared/star-system";
import { type SaveSummary, SLOT_COUNT } from "core/Worlds/shared/worlds";
import { PageHeading, ReturnButton, Reveal } from "lobby/Menu/client/components/page-parts";

interface SavesPageProps {
	/** The filled slots, or `undefined` until the server has sent them. */
	readonly saves: () => ReadonlyArray<SaveSummary> | undefined;
	readonly onLoad: (slot: number) => void;
	/** An empty slot was picked, to create a world in. */
	readonly onCreate: (slot: number) => void;
	/** Called once the player has confirmed. */
	readonly onDelete: (slot: number) => void;
	/** Asks the server for the slots. Called as the page opens. */
	readonly onRefresh: () => void;
	readonly onReturn: () => void;
	/** Turns false while the page is leaving, so its parts play their exit. */
	readonly show?: () => boolean;
}

/**
 * The player's save slots side by side, rising in one after another. A filled slot shows its world and has LOAD and
 * DELETE; an empty one is a button that opens the Create page for it. Deleting asks first.
 */
export function SavesPage({ saves, onLoad, onCreate, onDelete, onRefresh, onReturn, show }: SavesPageProps) {
	const confirming = source(false);
	// Kept after the dialog closes, so its text holds while it leaves.
	const target = source(1);

	onRefresh();

	const slots = new Array<number>();
	for (let slot = 1; slot <= SLOT_COUNT; slot++) slots.push(slot);

	return (
		<frame Name="SavesPage" BackgroundTransparency={1} Size={UDim2.fromScale(1, 1)}>
			<PageHeading title="SAVES" subtitle="Load a saved world, or pick an empty slot to create one" show={show} />
			{slots.map((slot) => (
				<SlotCard
					slot={slot}
					save={() => saves()?.find((save) => save.slot === slot)}
					loading={() => saves() === undefined}
					onLoad={() => onLoad(slot)}
					onCreate={() => onCreate(slot)}
					onDelete={() => {
						target(slot);
						confirming(true);
					}}
					position={UDim2.fromScale((slot - 1) * 0.34, 0.2)}
					size={UDim2.fromScale(0.32, 0.66)}
					delay={slot * 0.06}
					show={show}
				/>
			))}
			<ReturnButton onClick={onReturn} show={show} delay={0.3} />

			<Show when={confirming}>
				{(_, visible) =>
					$tuple(
						<Modal
							show={visible}
							text={() => `Delete the world in slot ${target()}? This can't be undone.`}
						>
							<Button
								text="BACK"
								color={COLORS.stroke}
								onClick={() => confirming(false)}
								position={UDim2.fromScale(0.08, 0.68)}
								size={UDim2.fromScale(0.38, 0.2)}
							/>
							<Button
								text="DELETE"
								color={COLORS.danger}
								onClick={() => {
									confirming(false);
									onDelete(target());
								}}
								position={UDim2.fromScale(0.54, 0.68)}
								size={UDim2.fromScale(0.38, 0.2)}
							/>
						</Modal>,
						EXIT_TIME,
					)
				}
			</Show>
		</frame>
	);
}

interface SlotCardProps {
	readonly slot: number;
	readonly save: () => SaveSummary | undefined;
	readonly loading: () => boolean;
	readonly onLoad: () => void;
	readonly onCreate: () => void;
	readonly onDelete: () => void;
	readonly position: UDim2;
	readonly size: UDim2;
	readonly delay: number;
	readonly show?: () => boolean;
}

/**
 * One save slot. Filled, it shows its star, how far the campaign has got, its difficulty, privacy and when it was
 * last saved, all decoding as the card lands and again when they change. Empty, the whole card is a button.
 * Hovering lifts it.
 */
function SlotCard({ slot, save, loading, onLoad, onCreate, onDelete, position, size, delay, show }: SlotCardProps) {
	const hovered = source(false);
	const [lift, liftSpring] = useSpring<number>(0, SPRINGS.responsive);
	effect(() => liftSpring.setGoal(hovered() ? 1 : 0));

	const empty = derive(() => !loading() && save() === undefined);
	const details = derive(() => {
		const current = save();
		if (!current) return undefined;
		const { settings } = current;
		const system = generateStarSystem(settings);
		const summary = summarizeStarSystem(system, settings);
		return {
			star: system.star.upper(),
			progress: settings.sandbox
				? `SANDBOX: ${settings.sandbox.upper()}`
				: `${current.conquered}/${summary.planets} LIBERATED`,
			difficulty: settings.sandbox ? undefined : summary.difficulty,
			privacy: current.isPrivate ? "PRIVATE" : "PUBLIC",
			saved: `SAVED ${DateTime.fromUnixTimestamp(current.savedAt).FormatLocalTime("lll", "en-us").upper()}`,
		};
	});

	const tag = useScramble("card", () => `SLOT 0${slot}`, delay + 0.2, 0.3);
	const title = useScramble("card", () => (loading() ? "..." : (details()?.star ?? "EMPTY")), delay + 0.12, 0.4);

	return (
		<Reveal show={show} delay={delay} position={position} size={size}>
			<Panel kind="card" lift={lift} rescan={save}>
				<textbutton
					BackgroundTransparency={1}
					Size={UDim2.fromScale(1, 1)}
					Text=""
					MouseEnter={() => hovered(true)}
					MouseLeave={() => hovered(false)}
					Activated={() => {
						if (empty()) onCreate();
					}}
				/>
				<textlabel
					BackgroundTransparency={1}
					FontFace={FONT_LABEL}
					Position={UDim2.fromScale(0.07, 0.05)}
					Size={UDim2.fromScale(0.5, 0.06)}
					Text={tag}
					TextColor3={() => (hovered() ? COLORS.accent : COLORS.muted)}
					TextScaled={true}
					TextXAlignment={Enum.TextXAlignment.Left}
				/>
				<textlabel
					BackgroundTransparency={1}
					FontFace={FONT_DISPLAY}
					Position={UDim2.fromScale(0.07, 0.14)}
					Size={UDim2.fromScale(0.86, 0.11)}
					Text={title}
					TextColor3={() => (details() ? COLORS.text : COLORS.subtext)}
					TextScaled={true}
					TextXAlignment={Enum.TextXAlignment.Left}
				/>

				<Show when={empty}>
					{() => (
						<textlabel
							BackgroundTransparency={1}
							FontFace={FONT}
							Position={UDim2.fromScale(0.07, 0.28)}
							Size={UDim2.fromScale(0.86, 0.06)}
							Text="Click to create a new world"
							TextColor3={COLORS.muted}
							TextScaled={true}
							TextXAlignment={Enum.TextXAlignment.Left}
						/>
					)}
				</Show>

				<Show when={() => details() !== undefined}>
					{() => (
						<>
							<Line text={() => details()?.progress ?? ""} y={0.3} delay={delay + 0.2} />
							<Line
								text={() => {
									const level = details()?.difficulty;
									return level !== undefined ? `DIFFICULTY ${LEVEL_NAMES[level].upper()}` : "";
								}}
								color={() => LEVEL_COLORS[details()?.difficulty ?? 0]}
								y={0.39}
								delay={delay + 0.25}
							/>
							<Line text={() => details()?.privacy ?? ""} y={0.48} delay={delay + 0.3} />
							<Line text={() => details()?.saved ?? ""} y={0.57} delay={delay + 0.35} muted={true} />
							<Button
								text="LOAD"
								color={COLORS.confirm}
								onClick={onLoad}
								position={UDim2.fromScale(0.07, 0.8)}
								size={UDim2.fromScale(0.52, 0.13)}
							/>
							<Button
								text="DELETE"
								color={COLORS.danger}
								onClick={onDelete}
								position={UDim2.fromScale(0.63, 0.8)}
								size={UDim2.fromScale(0.3, 0.13)}
							/>
						</>
					)}
				</Show>
			</Panel>
		</Reveal>
	);
}

interface LineProps {
	readonly text: () => string;
	/** Its top, as a fraction of the card's height. */
	readonly y: number;
	readonly delay: number;
	readonly color?: () => Color3;
	readonly muted?: boolean;
}

/** One line of a filled slot's details. Decodes as it lands, and again when it changes. */
function Line({ text, y, delay, color, muted }: LineProps) {
	const decoded = useScramble("text", derive(text), delay, 0.4);

	return (
		<textlabel
			BackgroundTransparency={1}
			FontFace={FONT_LABEL}
			Position={UDim2.fromScale(0.07, y)}
			Size={UDim2.fromScale(0.86, 0.065)}
			Text={decoded}
			TextColor3={color ?? (muted ? COLORS.muted : COLORS.text)}
			TextScaled={true}
			TextXAlignment={Enum.TextXAlignment.Left}
		/>
	);
}
