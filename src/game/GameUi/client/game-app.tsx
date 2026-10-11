import { Players } from "@rbxts/services";
import Vide, { derive, Show, source } from "@rbxts/vide";
import { useAtom } from "@rbxts/vide-charm";

import { EXIT_TIME } from "core/Interface/client/motion";
import { hudVisibleAtom } from "core/Interface/client/ui-state";
import { generateStarSystem } from "core/Worlds/shared/star-system";
import {
	baseStateAtom,
	buildModeAtom,
	equippedAtom,
	inventoryAtom,
	noticesAtom,
	toggleBuildMode,
	toggleTool,
	toolsAtom,
} from "game/Base/client/base-state";
import { CargoPanel, CoreStatus, Notices, ResultBanner, WavePanel } from "game/Base/client/components/base-hud";
import { BuildBar } from "game/Base/client/components/build-bar";
import { Hotbar } from "game/Base/client/components/hotbar";
import { BaseMessage, baseMessaging } from "game/Base/shared/base-network";
import { BUILD_TOOL, BUILDABLE } from "game/Base/shared/buildings";
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
	const buildMode = useAtom(buildModeAtom);
	const tools = useAtom(toolsAtom);
	const equipped = useAtom(equippedAtom);
	const debugOpen = useAtom(terrainDebugOpenAtom);
	const debugState = useAtom(terrainDebugAtom);
	const levels = useAtom(levelsAtom);
	const discovered = useAtom(discoveredAtom);
	const researchOpen = useAtom(researchOpenAtom);

	// The team between planets, for the local player once they're down there.
	const travel = () => (deployed() ? world()?.travel : undefined);
	// The world while the star map is up: before deploying, or opened from the ground, and never while travelling.
	const browsing = () => ((!deployed() || mapOpen()) && !travel() ? world() : undefined);
	// The base while the local player is down on its planet with the map closed.
	const mission = () => (deployed() && !mapOpen() ? base() : undefined);
	const result = () => {
		const phase = mission()?.phase;
		return phase === "won" || phase === "lost" ? phase : undefined;
	};
	const plan = () => (deployed() ? world()?.plan : undefined);
	const star = derive(() => {
		const state = world();
		return state ? generateStarSystem(state.seed).star : "";
	});
	const planets = derive(() => {
		const state = world();
		return state ? generateStarSystem(state.seed).planets : [];
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
				<Show when={world}>
					{() => (
						<WorldHeader
							star={star}
							code={() => world()?.code ?? ""}
							isPrivate={() => world()?.isPrivate ?? false}
						/>
					)}
				</Show>
				<Show when={browsing}>
					{(state, show) => {
						// Set by Deploy, so the button says the terrain is generating instead of offering Deploy again.
						const deploying = source(false);
						// Stays mounted for EXIT_TIME after closing, so the panel can slide out.
						return $tuple(
							<>
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
								<CoreStatus state={state} show={show} />
								<WavePanel
									state={state}
									show={show}
									onCallWave={() => baseMessaging.server.emit(BaseMessage.CallWave)}
								/>
								<CargoPanel inventory={inventory} show={show} />
								<Hotbar tools={tools} equipped={equipped} onSelect={toggleTool} show={show} />
							</>,
							EXIT_TIME,
						)
					}
				</Show>
				<Show when={() => mission()?.phase === "active" && equipped()?.Name === BUILD_TOOL}>
					{(_, show) =>
						$tuple(
							<BuildBar
								kinds={() => BUILDABLE.filter((kind) => canBuild(levels(), kind))}
								pool={() => base()?.pool ?? []}
								mode={buildMode}
								onSelect={toggleBuildMode}
								show={show}
							/>,
							EXIT_TIME,
						)
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
				<Show when={() => mission() !== undefined && researchOpen()}>
					{(_, show) =>
						$tuple(
							<ResearchTree
								levels={levels}
								gates={() => ({ conquered: world()?.conquered.size() ?? 0, discovered: discovered() })}
								pool={() => base()?.pool ?? []}
								onResearch={(id) => researchMessaging.server.emit(ResearchMessage.Research, { id })}
								onClose={() => researchOpenAtom(false)}
								show={show}
							/>,
							EXIT_TIME,
						)
					}
				</Show>
			</screengui>

			{/* Over the research tree, so its refusals show. */}
			<screengui Name="Notices" DisplayOrder={6} Enabled={visible} ResetOnSpawn={false}>
				<Notices notices={notices} />
			</screengui>

			{/* Over everything, the HUD toggle included: it hides the next planet generating. */}
			<screengui Name="TravelOverlay" DisplayOrder={20} IgnoreGuiInset={true} ResetOnSpawn={false}>
				<Show when={() => (travel()?.stage === "transit" ? travel() : undefined)}>
					{(current, show) =>
						$tuple(
							<TravelOverlay destination={() => planets()[current().to]?.name ?? ""} show={show} />,
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
		</>
	);
}
