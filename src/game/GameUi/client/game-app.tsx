import Vide, { derive, Show, source } from "@rbxts/vide";
import { useAtom } from "@rbxts/vide-charm";

import { EXIT_TIME } from "core/Interface/client/motion";
import { hudVisibleAtom } from "core/Interface/client/ui-state";
import { generateStarSystem } from "core/Worlds/shared/star-system";
import { baseStateAtom, buildModeAtom, inventoryAtom, noticesAtom, toggleBuildMode } from "game/Base/client/base-state";
import { CargoPanel, CoreStatus, Notices, ResultBanner, WavePanel } from "game/Base/client/components/base-hud";
import { BuildBar } from "game/Base/client/components/build-bar";
import { BaseMessage, baseMessaging } from "game/Base/shared/base-network";
import { PlanetPanel } from "game/Planets/client/components/planet-panel";
import { ControlsHint, StarMap } from "game/Planets/client/components/star-map";
import { WorldHeader } from "game/Planets/client/components/world-header";
import { focusPlanet } from "game/Planets/client/galaxy-camera";
import { deployedAtom, hoveredPlanetAtom, selectedPlanetAtom, worldStateAtom } from "game/Planets/client/planets-state";
import { PlanetsMessage, planetsMessaging } from "game/Planets/shared/planets-network";
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
	const selected = useAtom(selectedPlanetAtom);
	const hovered = useAtom(hoveredPlanetAtom);
	const base = useAtom(baseStateAtom);
	const inventory = useAtom(inventoryAtom);
	const notices = useAtom(noticesAtom);
	const buildMode = useAtom(buildModeAtom);
	const debugOpen = useAtom(terrainDebugOpenAtom);
	const debugState = useAtom(terrainDebugAtom);

	// The world while players are still choosing a planet: known, and the local player not yet deployed.
	const choosing = () => (deployed() ? undefined : world());
	// The mission while the local player is down on its planet.
	const mission = () => (deployed() ? base() : undefined);
	const result = () => {
		const phase = mission()?.phase;
		return phase === "won" || phase === "lost" ? phase : undefined;
	};
	const star = derive(() => {
		const state = world();
		return state ? generateStarSystem(state.seed).star : "";
	});

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
				<Show when={choosing}>
					{(state, show) => {
						const planets = generateStarSystem(state().seed).planets;
						// Set by Deploy, so the button says the terrain is generating instead of offering Deploy again.
						const deploying = source(false);
						// Stays mounted for EXIT_TIME after deploying, so the panel can slide out.
						return $tuple(
							<>
								<PlanetPanel
									show={show}
									planet={() => planets[selected()]}
									unlocked={() => state().unlocked.includes(selected())}
									standing={() =>
										state().active === selected()
											? "active"
											: state().conquered.includes(selected())
												? "liberated"
												: undefined
									}
									blocked={() => {
										const active = state().active;
										if (deploying() && base()?.phase === "generating")
											return "GENERATING TERRAIN...";
										if (state().conquered.includes(selected())) return "ALREADY LIBERATED";
										if (active !== undefined && active !== selected()) {
											return `MISSION ON ${planets[active].name.upper()}`;
										}
										return undefined;
									}}
									onDeploy={() => {
										deploying(true);
										planetsMessaging.server.emit(PlanetsMessage.Deploy, { planet: selected() });
									}}
								/>
								<ControlsHint show={show} />
							</>,
							EXIT_TIME,
						);
					}}
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
							</>,
							EXIT_TIME,
						)
					}
				</Show>
				<Show when={() => mission()?.phase === "active"}>
					{(_, show) =>
						$tuple(
							<BuildBar
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
				<Notices notices={notices} />
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
			<Show when={choosing}>
				{(state, show) =>
					$tuple(
						<StarMap
							world={state}
							selected={selected}
							show={show}
							hovered={hovered}
							onSelect={focusPlanet}
						/>,
						EXIT_TIME,
					)
				}
			</Show>
		</>
	);
}
