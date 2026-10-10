import Vide, { cleanup, derive, effect, Index, Show, source } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Button } from "core/Interface/client/components/button";
import { Brackets, EnergyGradient } from "core/Interface/client/components/hud";
import { Panel } from "core/Interface/client/components/panel";
import { ScrollList } from "core/Interface/client/components/scroll-list";
import { Shadow } from "core/Interface/client/components/shadow";
import { PulseDot } from "core/Interface/client/components/spinner";
import { EXIT_TIME, useAppear, useScramble } from "core/Interface/client/motion";
import { COLORS, FONT, FONT_LABEL, SPRINGS } from "core/Interface/client/theme";
import { generateStarSystem } from "core/Worlds/shared/star-system";
import { CODE_LENGTH, isValidCode, MAX_PLAYERS, type WorldSummary } from "core/Worlds/shared/worlds";
import { PageHeading, ReturnButton, Reveal, TextField } from "lobby/Menu/client/components/page-parts";

/** Seconds between automatic list refreshes while the page is open. */
const REFRESH_SECONDS = 10;

interface JoinPageProps {
	readonly worlds: () => ReadonlyArray<WorldSummary>;
	readonly onJoin: (code: string) => void;
	/** Asks the server for the world list. Called when the page opens, then every few seconds. */
	readonly onRefresh: () => void;
	readonly onReturn: () => void;
	/** Turns false while the page is leaving, so its parts play their exit. */
	readonly show?: () => boolean;
}

/**
 * The public worlds with a JOIN button each, and a box to join any world by its code. Rows rise in one after
 * another and fade away when their world goes. REFRESH kicks the list so it is plain something happened, and every
 * refresh, manual or timed, sweeps a scan line down the list. A readout of how many worlds are online decodes
 * whenever the count changes.
 */
export function JoinPage({ worlds, onJoin, onRefresh, onReturn, show }: JoinPageProps) {
	const code = source("");
	const empty = useAppear(() => worlds().size() === 0);
	const joinLabel = useScramble("text", () => "JOIN BY CODE", 0.3, 0.4);
	// Counts REFRESH clicks, so the list scans for those too and not only when new worlds arrive.
	const refreshes = source(0);
	// Derived, so a refresh that finds the same number of worlds doesn't decode it again.
	const online = derive(() => {
		const count = worlds().size();
		return `${count < 10 ? "0" : ""}${count} ${count === 1 ? "WORLD" : "WORLDS"} ONLINE`;
	});
	const readout = useScramble("text", online, 0.3, 0.4);
	// Springs back to rest after REFRESH shoves it: the list bounces and its panel flashes.
	const [kick, kickSpring] = useSpring<number>(0, SPRINGS.bouncy);

	// Refreshes as the page opens, then on a timer for as long as it stays open.
	cleanup(
		task.spawn(() => {
			while (true) {
				onRefresh();
				task.wait(REFRESH_SECONDS);
			}
		}),
	);

	return (
		<frame Name="JoinPage" BackgroundTransparency={1} Size={UDim2.fromScale(1, 1)}>
			<PageHeading title="JOIN" subtitle="Join a public world or enter a code" show={show} />
			<Reveal
				show={show}
				delay={0.1}
				anchorPoint={new Vector2(1, 0)}
				position={UDim2.fromScale(1, 0.02)}
				size={UDim2.fromScale(0.16, 0.08)}
			>
				<Button
					text="REFRESH"
					color={COLORS.stroke}
					onClick={() => {
						onRefresh();
						refreshes(refreshes() + 1);
						kickSpring.impulse(10);
					}}
					anchorPoint={new Vector2(0.5, 0.5)}
					position={UDim2.fromScale(0.5, 0.5)}
					size={UDim2.fromScale(1, 1)}
				/>
			</Reveal>

			<Reveal
				show={show}
				delay={0.12}
				scale={1}
				position={UDim2.fromScale(0.7, 0.14)}
				size={UDim2.fromScale(0.3, 0.04)}
			>
				<PulseDot
					anchorPoint={new Vector2(0, 0.5)}
					position={new UDim2(0, 6, 0.5, 0)}
					color={() => (worlds().size() > 0 ? COLORS.confirm : COLORS.subtext)}
				/>
				<textlabel
					BackgroundTransparency={1}
					FontFace={FONT_LABEL}
					Position={new UDim2(0, 22, 0, 0)}
					Size={new UDim2(1, -22, 1, 0)}
					Text={readout}
					TextColor3={COLORS.muted}
					TextScaled={true}
					TextXAlignment={Enum.TextXAlignment.Left}
				/>
			</Reveal>

			<Reveal
				show={show}
				delay={0.06}
				scale={0.97}
				position={UDim2.fromScale(0, 0.2)}
				size={UDim2.fromScale(1, 0.5)}
			>
				<Panel
					lift={kick}
					rescan={() => {
						worlds();
						refreshes();
					}}
				>
					<frame
						AnchorPoint={new Vector2(0.5, 0.5)}
						BackgroundTransparency={1}
						Position={() => new UDim2(0.5, 0, 0.5, kick() * 8)}
						Size={UDim2.fromScale(0.97, 0.92)}
					>
						<ScrollList gap={10} padding={20}>
							<Index each={worlds}>
								{(world, index, visible) =>
									$tuple(
										<WorldRow
											world={world}
											order={index}
											delay={math.min(index - 1, 6) * 0.05}
											show={visible}
											onJoin={onJoin}
										/>,
										EXIT_TIME,
									)
								}
							</Index>
						</ScrollList>
					</frame>
					<textlabel
						AnchorPoint={new Vector2(0.5, 0.5)}
						BackgroundTransparency={1}
						FontFace={FONT}
						Position={() => new UDim2(0.5, 0, 0.5, (1 - empty()) * 12)}
						Size={UDim2.fromScale(0.8, 0.14)}
						Text="No public worlds right now. Create one!"
						TextColor3={COLORS.muted}
						TextScaled={true}
						TextTransparency={() => 1 - math.clamp(empty(), 0, 1)}
					/>
				</Panel>
			</Reveal>

			<Reveal
				show={show}
				delay={0.14}
				scale={0.97}
				position={UDim2.fromScale(0, 0.73)}
				size={UDim2.fromScale(1, 0.13)}
			>
				<Panel>
					<textlabel
						AnchorPoint={new Vector2(0, 0.5)}
						BackgroundTransparency={1}
						FontFace={FONT_LABEL}
						Position={UDim2.fromScale(0.02, 0.5)}
						Size={UDim2.fromScale(0.21, 0.34)}
						Text={joinLabel}
						TextColor3={COLORS.muted}
						TextScaled={true}
						TextXAlignment={Enum.TextXAlignment.Left}
					/>
					<TextField
						anchorPoint={new Vector2(0, 0.5)}
						position={UDim2.fromScale(0.24, 0.5)}
						size={UDim2.fromScale(0.3, 0.65)}
						placeholder="ENTER CODE"
						onChanged={(text, box) => {
							// Codes are upper case and fixed length. Anything extra typed is dropped as it arrives.
							const clean = text.upper().sub(1, CODE_LENGTH);
							if (clean !== text) box.Text = clean;
							code(clean);
						}}
					/>
					<Button
						text="JOIN"
						color={COLORS.confirm}
						disabled={() => !isValidCode(code())}
						onClick={() => onJoin(code())}
						anchorPoint={new Vector2(1, 0.5)}
						position={UDim2.fromScale(0.98, 0.5)}
						size={UDim2.fromScale(0.2, 0.65)}
					/>
				</Panel>
			</Reveal>

			<ReturnButton onClick={onReturn} show={show} delay={0.2} />
		</frame>
	);
}

interface WorldRowProps {
	readonly world: () => WorldSummary;
	readonly order: number;
	/** Seconds before the row rises in, so rows arrive one after another. */
	readonly delay: number;
	/** Turns false when the world leaves the list. */
	readonly show: () => boolean;
	readonly onJoin: (code: string) => void;
}

/**
 * One public world: host, star, player count and a JOIN button that greys out when the world is full. The host,
 * star and count decode as the row rises, and again whenever one changes. Its height is a fraction of its width
 * (`RelativeXX`), so rows keep their shape whatever the list's height.
 * Hovering lifts it: it brightens, its shadow glows, brackets lock onto its corners and energy runs round its
 * outline. That energy is only mounted while the row is hovered, so a long list doesn't spin one per row.
 */
function WorldRow({ world, order, delay, show, onJoin }: WorldRowProps) {
	const star = derive(() => generateStarSystem(world().seed).star.upper());
	const host = derive(() => world().hostName);
	const players = derive(() => `${world().players}/${MAX_PLAYERS}`);
	const hostText = useScramble("row", host, delay + 0.1, 0.4);
	const starText = useScramble("row", star, delay + 0.15, 0.4);
	const playersText = useScramble("row", players, delay + 0.2, 0.3);
	const hovered = source(false);
	const [lift, liftSpring] = useSpring<number>(0, SPRINGS.responsive);

	effect(() => liftSpring.setGoal(hovered() ? 1 : 0));
	return (
		<frame
			BackgroundTransparency={1}
			LayoutOrder={order}
			Size={UDim2.fromScale(1, 0.065)}
			SizeConstraint={Enum.SizeConstraint.RelativeXX}
		>
			<Reveal show={show} delay={delay} distance={14} scale={0.98}>
				<Shadow lift={lift} glow={COLORS.accent} scale={0.6} visibility={lift} />
				<frame
					BackgroundColor3={COLORS.card}
					BackgroundTransparency={() => 0.5 - 0.15 * lift()}
					Size={UDim2.fromScale(1, 1)}
					ZIndex={1}
					MouseEnter={() => hovered(true)}
					MouseLeave={() => hovered(false)}
				>
					<uicorner CornerRadius={new UDim(0.15, 0)} />
					<uistroke
						ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
						Color={COLORS.text}
						Thickness={1.5}
						Transparency={() => 1 - 0.85 * math.clamp(lift(), 0, 1)}
					>
						<Show when={hovered}>
							{() =>
								$tuple(
									<EnergyGradient
										kind="row"
										base={() =>
											COLORS.stroke.Lerp(COLORS.accent, 0.35 + 0.65 * math.clamp(lift(), 0, 1))
										}
										energy={COLORS.text}
										charge={lift}
									/>,
									EXIT_TIME,
								)
							}
						</Show>
					</uistroke>
					<textlabel
						AnchorPoint={new Vector2(0, 0.5)}
						BackgroundTransparency={1}
						FontFace={FONT_LABEL}
						Position={UDim2.fromScale(0.03, 0.5)}
						Size={UDim2.fromScale(0.35, 0.5)}
						Text={hostText}
						TextColor3={COLORS.text}
						TextScaled={true}
						TextXAlignment={Enum.TextXAlignment.Left}
					/>
					<textlabel
						AnchorPoint={new Vector2(0, 0.5)}
						BackgroundTransparency={1}
						FontFace={FONT_LABEL}
						Position={UDim2.fromScale(0.4, 0.5)}
						Size={UDim2.fromScale(0.24, 0.5)}
						Text={starText}
						TextColor3={COLORS.muted}
						TextScaled={true}
						TextXAlignment={Enum.TextXAlignment.Left}
					/>
					<textlabel
						AnchorPoint={new Vector2(0, 0.5)}
						BackgroundTransparency={1}
						FontFace={FONT_LABEL}
						Position={UDim2.fromScale(0.66, 0.5)}
						Size={UDim2.fromScale(0.12, 0.5)}
						Text={playersText}
						TextColor3={COLORS.text}
						TextScaled={true}
						TextXAlignment={Enum.TextXAlignment.Left}
					/>
					<Button
						text="JOIN"
						color={COLORS.confirm}
						disabled={() => world().players >= MAX_PLAYERS}
						onClick={() => onJoin(world().code)}
						anchorPoint={new Vector2(1, 0.5)}
						position={UDim2.fromScale(0.98, 0.5)}
						size={UDim2.fromScale(0.16, 0.7)}
					/>
				</frame>
				<Brackets kind="row" open={lift} visibility={lift} length={8} thickness={1.5} />
			</Reveal>
		</frame>
	);
}
