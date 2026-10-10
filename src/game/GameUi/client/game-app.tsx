import Vide, { derive, Show } from "@rbxts/vide";
import { useAtom } from "@rbxts/vide-charm";

import { EXIT_TIME } from "core/Interface/client/motion";
import { hudVisibleAtom } from "core/Interface/client/ui-state";
import { generateStarSystem } from "core/Worlds/shared/star-system";
import { PlanetPanel } from "game/Planets/client/components/planet-panel";
import { ControlsHint, StarMap } from "game/Planets/client/components/star-map";
import { WorldHeader } from "game/Planets/client/components/world-header";
import { focusPlanet } from "game/Planets/client/galaxy-camera";
import { deployedAtom, hoveredPlanetAtom, selectedPlanetAtom, worldStateAtom } from "game/Planets/client/planets-state";
import { PlanetsMessage, planetsMessaging } from "game/Planets/shared/planets-network";

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

	// The world while players are still choosing a planet: known, and the local player not yet deployed.
	const choosing = () => (deployed() ? undefined : world());
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
						// Stays mounted for EXIT_TIME after deploying, so the panel can slide out.
						return $tuple(
							<>
								<PlanetPanel
									show={show}
									planet={() => planets[selected()]}
									unlocked={() => state().unlocked.includes(selected())}
									onDeploy={() =>
										planetsMessaging.server.emit(PlanetsMessage.Deploy, { planet: selected() })
									}
								/>
								<ControlsHint show={show} />
							</>,
							EXIT_TIME,
						);
					}}
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
