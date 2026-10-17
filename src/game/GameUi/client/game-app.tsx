import { Players } from "@rbxts/services";
import Vide, { derive, For, Show, source } from "@rbxts/vide";
import { useAtom } from "@rbxts/vide-charm";

import { ScreenEffect } from "core/Interface/client/components/screen-effect";
import { EXIT_TIME } from "core/Interface/client/motion";
import { hudVisibleAtom } from "core/Interface/client/ui-state";
import { generateStarSystem } from "core/Worlds/shared/star-system";
import {
	baseStateAtom,
	blasterNow,
	buildModeAtom,
	coreAttackedAtom,
	equippedAtom,
	infoAtom,
	inventoryAtom,
	nearSelectedAtom,
	noticesAtom,
	selectedAtom,
	selectedOreAtom,
	toggleBuildMode,
	toggleTool,
	toolsAtom,
	waveBannerAtom,
} from "game/Base/client/base-state";
import {
	CargoPanel,
	CoreWarning,
	Notices,
	ResultBanner,
	SandboxPanel,
	WaveBanner,
	WavePanel,
} from "game/Base/client/components/base-hud";
import { BuildBar } from "game/Base/client/components/build-bar";
import { BuildingPanel } from "game/Base/client/components/building-panel";
import { Hotbar } from "game/Base/client/components/hotbar";
import { TurretInfo } from "game/Base/client/components/turret-info";
import { cellOf } from "game/Base/client/InteractController";
import {
	BaseMessage,
	baseMessaging,
	BeltMessage,
	beltMessaging,
	SandboxMessage,
	sandboxMessaging,
} from "game/Base/shared/base-network";
import { blastersOf } from "game/Base/shared/blasters";
import { BUILD_TOOL, type BuildableKind, BUILDABLE } from "game/Base/shared/buildings";
import { LoadoutPanel, PlanPanel, TravelOverlay } from "game/Planets/client/components/launch-panel";
import { PlanetPanel } from "game/Planets/client/components/planet-panel";
import { ControlsHint, StarMap } from "game/Planets/client/components/star-map";
import { WorldHeader } from "game/Planets/client/components/world-header";
import { focusPlanet } from "game/Planets/client/galaxy-camera";
import {
	composingAtom,
	deployedAtom,
	hoveredPlanetAtom,
	selectedPlanetAtom,
	starMapOpenAtom,
	worldStateAtom,
} from "game/Planets/client/planets-state";
import { PlanetsMessage, planetsMessaging, retreatTarget } from "game/Planets/shared/planets-network";
import { ResearchTree } from "game/Research/client/components/research-tree";
import { discoveredAtom, levelsAtom, researchOpenAtom } from "game/Research/client/research-state";
import { canBuild } from "game/Research/shared/research";
import { ResearchMessage, researchMessaging } from "game/Research/shared/research-network";
import { TerrainDebugPanel } from "game/Terrain/client/components/terrain-debug";
import { terrainDebugAtom, terrainDebugOpenAtom } from "game/Terrain/client/terrain-debug-state";
import { TerrainMessage, terrainMessaging } from "game/Terrain/shared/terrain-network";
import { TutorialArrow } from "game/Tutorial/client/components/tutorial-arrow";
import { TutorialHighlight } from "game/Tutorial/client/components/tutorial-highlight";
import { TutorialPanel } from "game/Tutorial/client/components/tutorial-panel";
import { tutorialHintAtom, unlockedAtom } from "game/Tutorial/client/tutorial-state";
import { TUTORIAL_STEPS } from "game/Tutorial/shared/tutorial";
import { TutorialMessage, tutorialMessaging } from "game/Tutorial/shared/tutorial-network";

/**
 * Everything on screen that only exists in a world server. Core's `App` still
 * draws the shared HUD and loading screen. This is where the game's components
 * are wired to their atoms and messages.
 */
export function GameApp() {
	const visible = useAtom(hudVisibleAtom);
	const world = useAtom(worldStateAtom);
	const deployed = useAtom(deployedAtom);
	const mapOpen = useAtom(starMapOpenAtom);
	const composing = useAtom(composingAtom);
	const selected = useAtom(selectedPlanetAtom);
	const hovered = useAtom(hoveredPlanetAtom);
	const base = useAtom(baseStateAtom);
	const inventory = useAtom(inventoryAtom);
	const notices = useAtom(noticesAtom);
	const coreAttacked = useAtom(coreAttackedAtom);
	const waveBanner = useAtom(waveBannerAtom);
	const buildMode = useAtom(buildModeAtom);
	const clicked = useAtom(selectedAtom);
	const nearClicked = useAtom(nearSelectedAtom);
	const blaster = useAtom(blasterNow);
	const clickedOre = useAtom(selectedOreAtom);
	const tools = useAtom(toolsAtom);
	const equipped = useAtom(equippedAtom);
	const debugOpen = useAtom(terrainDebugOpenAtom);
	const debugState = useAtom(terrainDebugAtom);
	const levels = useAtom(levelsAtom);
	const discovered = useAtom(discoveredAtom);
	const researchOpen = useAtom(researchOpenAtom);
	const info = useAtom(infoAtom);
	const tutorial = useAtom(tutorialHintAtom);

	// The team between planets, for the local player once they're down there.
	const travel = () => (deployed() ? world()?.travel : undefined);
	// Deployed while the planet was generating: the overlay covers the wait till the character spawns.
	const awaiting = source(false);
	// The world while the star map is up: before deploying, or opened from the ground, and never while travelling.
	const browsing = () => ((!deployed() || mapOpen()) && !travel() ? world() : undefined);
	// The base while the local player is down on its planet with the map closed.
	const mission = () => (deployed() && !mapOpen() ? base() : undefined);
	const result = () => {
		const phase = mission()?.phase;
		return phase === "won" || phase === "lost" ? phase : undefined;
	};
	const plan = () => (deployed() ? world()?.plan : undefined);
	// The overlay's up, which hides the tutorial rather than leave its arrow pointing at nothing.
	const hint = () => (travel()?.stage === "transit" || (awaiting() && !deployed()) ? undefined : tutorial());
	// Derived from research and the sandbox flag alone, not the whole base state, which changes several times a second.
	const sandbox = derive(() => base()?.sandbox === true);
	const buildable = derive(() => BUILDABLE.filter((kind) => canBuild(levels(), kind, sandbox())));
	const building = derive(() => mission()?.phase === "active" && equipped()?.Name === BUILD_TOOL);
	const researching = derive(() => mission() !== undefined && researchOpen());
	const star = derive(() => {
		const state = world();
		return state ? generateStarSystem(state).star : "";
	});
	const planets = derive(() => {
		const state = world();
		return state ? generateStarSystem(state).planets : [];
	});
	const active = () => world()?.active;
	// On a planet enemies hold, the only way off is a retreat.
	const occupied = () => {
		const current = active();
		return current !== undefined && !world()?.conquered.includes(current);
	};
	const retreat = () => retreatTarget(world()?.conquered ?? [], active() ?? 0, planets().size());
	// Where the team can go from here, for the star map's route lines. Nowhere until the local player has deployed.
	const routes = (): ReadonlyArray<number> => {
		const state = world();
		const current = active();
		if (!state || !deployed() || current === undefined) return [];
		if (occupied()) return retreat() === current ? [] : [retreat()];
		return state.unlocked.filter((planet) => planet !== current);
	};

	return (
		<>
			<screengui Name="GameApp" Enabled={visible} ResetOnSpawn={false}>
				<Show when={browsing}>
					{(state, show) => {
						// Set by Deploy, so the button says the terrain is generating instead of offering Deploy again.
						const deploying = source(false);
						// Stays mounted for EXIT_TIME after closing, so the panel can slide out.
						return $tuple(
							<>
								<WorldHeader
									star={star}
									code={() => state().code}
									isPrivate={() => state().isPrivate}
									show={show}
								/>
								<PlanetPanel
									show={show}
									planet={() => planets()[selected()]}
									unlocked={() => state().unlocked.includes(selected())}
									standing={() =>
										state().conquered.includes(selected())
											? "liberated"
											: active() === selected()
												? "active"
												: undefined
									}
									blocked={() => {
										const current = active();
										if (!deployed()) {
											if (deploying() && base()?.phase === "generating")
												return "GENERATING TERRAIN...";
											if (current !== undefined && current !== selected()) {
												return `TEAM IS ON ${planets()[current].name.upper()}`;
											}
											return undefined;
										}
										if (current === selected()) return "YOU ARE HERE";
										if (state().plan) return "LAUNCH PENDING";
										if (base()?.phase !== "active") return "CAN'T LAUNCH NOW";
										if (occupied() && selected() !== retreat()) return "ENEMIES REMAIN";
										return undefined;
									}}
									action={() =>
										!deployed() ? "DEPLOY" : occupied() ? "RETREAT HERE" : "PLAN LAUNCH"
									}
									onDeploy={() => {
										if (!deployed()) {
											deploying(true);
											if (base()?.phase === "generating") awaiting(true);
											planetsMessaging.server.emit(PlanetsMessage.Deploy, { planet: selected() });
										} else if (occupied()) {
											planetsMessaging.server.emit(PlanetsMessage.Propose, {
												planet: selected(),
												cargo: [],
											});
										} else {
											composingAtom(selected());
										}
									}}
								/>
								<ControlsHint show={show} />
							</>,
							EXIT_TIME,
						);
					}}
				</Show>
				<Show when={() => (browsing() && !plan() ? composing() : undefined)}>
					{(destination, show) =>
						$tuple(
							<LoadoutPanel
								destination={destination}
								onBack={() => composingAtom(undefined)}
								onLaunch={(cargo) => {
									planetsMessaging.server.emit(PlanetsMessage.Propose, {
										planet: destination(),
										cargo,
									});
									composingAtom(undefined);
								}}
								planets={planets()}
								pool={() => base()?.pool ?? []}
								show={show}
							/>,
							EXIT_TIME,
						)
					}
				</Show>
				<Show when={plan}>
					{(current, show) =>
						$tuple(
							<PlanPanel
								onCancel={() => planetsMessaging.server.emit(PlanetsMessage.Cancel)}
								onReady={() => planetsMessaging.server.emit(PlanetsMessage.Ready)}
								plan={current}
								planets={planets()}
								userId={Players.LocalPlayer.UserId}
								show={show}
							/>,
							EXIT_TIME,
						)
					}
				</Show>
			</screengui>

			<screengui Name="BaseHud" Enabled={visible} ResetOnSpawn={false}>
				<Show when={mission}>
					{(state, show) =>
						$tuple(
							<>
								{/* A sandbox has no waves: its panel sends aliens instead. */}
								<Show when={() => !state().sandbox}>
									{(_, shown) =>
										$tuple(
											<WavePanel
												state={state}
												show={() => show() && shown()}
												onCallWave={() => baseMessaging.server.emit(BaseMessage.CallWave)}
												canCall={() => unlockedAtom("callWave")}
											/>,
											EXIT_TIME,
										)
									}
								</Show>
								<Show when={() => state().sandbox}>
									{(_, shown) =>
										$tuple(
											<SandboxPanel
												state={state}
												show={() => show() && shown()}
												onSpawn={(kind, count) =>
													sandboxMessaging.server.emit(SandboxMessage.Spawn, { kind, count })
												}
												onClear={() => sandboxMessaging.server.emit(SandboxMessage.Clear)}
											/>,
											EXIT_TIME,
										)
									}
								</Show>
								<CargoPanel
									inventory={inventory}
									show={show}
									onDrop={(resource) => baseMessaging.server.emit(BaseMessage.Drop, { resource })}
								/>
								<Hotbar tools={tools} equipped={equipped} onSelect={toggleTool} show={show} />
							</>,
							EXIT_TIME,
						)
					}
				</Show>
				{/* Mounted once and hidden while the Build tool is away: remaking it on every draw hitched. */}
				<BuildBar
					kinds={buildable}
					pool={() => base()?.pool ?? []}
					held={() => inventory().items}
					mode={buildMode}
					onSelect={toggleBuildMode}
					onInfo={(kind) => infoAtom(kind)}
					show={building}
				/>
				<Show when={() => (mission() !== undefined ? waveBanner() : undefined)}>
					{(wave, show) =>
						$tuple(<WaveBanner wave={wave} waves={() => mission()?.waves ?? 0} show={show} />, EXIT_TIME)
					}
				</Show>
				<Show when={result}>
					{(phase, show) => $tuple(<ResultBanner result={phase} show={show} />, EXIT_TIME)}
				</Show>
			</screengui>

			{/* Over the HUD, which it covers while open. */}
			<screengui
				Name="Research"
				DisplayOrder={5}
				Enabled={visible}
				IgnoreGuiInset={true}
				ResetOnSpawn={false}
				ZIndexBehavior={Enum.ZIndexBehavior.Sibling}
			>
				{/* Mounted once and hidden while closed: it's thousands of instances, too many to make on every open. */}
				<ResearchTree
					levels={levels}
					core={() => base()?.core ?? "core"}
					gates={() => ({ conquered: world()?.conquered.size() ?? 0, discovered: discovered() })}
					pool={() => base()?.pool ?? []}
					onResearch={(id) => researchMessaging.server.emit(ResearchMessage.Research, { id })}
					onClose={() => researchOpenAtom(false)}
					show={researching}
				/>
				<Show when={() => (mission() !== undefined ? info() : undefined)}>
					{(kind, show) =>
						$tuple(<TurretInfo kind={kind()} onClose={() => infoAtom(undefined)} show={show} />, EXIT_TIME)
					}
				</Show>
			</screengui>

			{/* Over the research tree, so its refusals show. */}
			<screengui Name="Notices" DisplayOrder={6} Enabled={visible} ResetOnSpawn={false}>
				<Notices notices={notices}>
					<Show when={coreAttacked}>{(_, show) => $tuple(<CoreWarning show={show} />, EXIT_TIME)}</Show>
				</Notices>
			</screengui>

			{/* Over the HUD, and left be by its toggle: it reports on the world, not the interface. */}
			<screengui Name="ScreenEffect" DisplayOrder={7} IgnoreGuiInset={true} ResetOnSpawn={false}>
				<ScreenEffect />
			</screengui>

			{/* Over the effects, and under the travel overlay. */}
			<screengui Name="Tutorial" DisplayOrder={8} Enabled={visible} IgnoreGuiInset={true} ResetOnSpawn={false}>
				<Show when={hint}>
					{(current, show) =>
						$tuple(
							<>
								<TutorialPanel
									step={() => current().step}
									steps={TUTORIAL_STEPS.size()}
									title={() => current().title}
									text={() => current().text}
									progress={() => current().progress}
									onSkip={() => tutorialMessaging.server.emit(TutorialMessage.Skip)}
									show={show}
								/>
								<TutorialArrow gui={() => current().gui} world={() => current().world} show={show} />
							</>,
							EXIT_TIME,
						)
					}
				</Show>
			</screengui>

			{/* Over everything, the HUD toggle included: it hides the next planet generating. */}
			<screengui Name="TravelOverlay" DisplayOrder={20} IgnoreGuiInset={true} ResetOnSpawn={false}>
				<Show
					when={() =>
						travel()?.stage === "transit" ? travel()?.to : awaiting() && !deployed() ? active() : undefined
					}
				>
					{(to, show) =>
						$tuple(
							<TravelOverlay
								destination={() => planets()[to()]?.name ?? ""}
								// Until the base state has caught up with where the core's headed, nothing of it is built.
								progress={() => {
									const state = base();
									return state?.planet === to() ? state.generated : 0;
								}}
								show={show}
							/>,
							EXIT_TIME,
						)
					}
				</Show>
			</screengui>

			{/* A developer tool, so the HUD toggle leaves it be. Drawn once the server has answered, which it does for trusted players only. */}
			<screengui Name="TerrainDebug" DisplayOrder={10} ResetOnSpawn={false}>
				<Show when={() => (debugOpen() ? debugState() : undefined)}>
					{(state) => (
						<TerrainDebugPanel
							state={state}
							onApply={(config) => terrainMessaging.server.emit(TerrainMessage.DebugApply, { config })}
						/>
					)}
				</Show>
			</screengui>

			{/* An outline in the world, so it is not UI either, but it follows the HUD toggle. */}
			<Show when={() => (visible() ? hint() : undefined)}>
				{(current, show) =>
					$tuple(<TutorialHighlight target={() => (show() ? current().world : undefined)} />, EXIT_TIME)
				}
			</Show>

			{/* The 3D map is not UI, so the HUD toggle leaves it be. */}
			<Show when={browsing}>
				{(state, show) =>
					$tuple(
						<StarMap
							world={state}
							selected={selected}
							show={show}
							hovered={hovered}
							onSelect={focusPlanet}
							routes={routes}
							retreat={occupied}
						/>,
						EXIT_TIME,
					)
				}
			</Show>

			{/* A billboard in the world, straight under PlayerGui so it takes clicks. Keyed, so another building gets a fresh one. */}
			<For each={() => (visible() && mission() !== undefined ? [clicked()].filterUndefined() : [])}>
				{(building) => (
					<BuildingPanel
						building={building}
						pool={() => base()?.pool ?? []}
						capacity={() => base()?.capacity ?? 0}
						near={nearClicked}
						onCollect={() => baseMessaging.server.emit(BaseMessage.Collect, cellOf(building))}
						onLoad={() => baseMessaging.server.emit(BaseMessage.Load, cellOf(building))}
						onPick={(resource) =>
							beltMessaging.server.emit(BeltMessage.Configure, { ...cellOf(building), resource })
						}
						ore={clickedOre}
						onTake={(resource) =>
							baseMessaging.server.emit(BaseMessage.Collect, { ...cellOf(building), resource })
						}
						onInfo={() => infoAtom(building.GetAttribute("Kind") as BuildableKind)}
						blasters={() => blastersOf(base()?.core ?? "core")}
						blaster={blaster}
						onBlaster={(kind) =>
							baseMessaging.server.emit(BaseMessage.PickBlaster, { ...cellOf(building), kind })
						}
					/>
				)}
			</For>
		</>
	);
}
