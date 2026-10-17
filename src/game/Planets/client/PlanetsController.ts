import { Controller, OnStart } from "@flamework/core";
import { computed, effect, subscribe, untracked } from "@rbxts/charm";
import { ContextActionService, Players, UserInputService } from "@rbxts/services";
import { Icon } from "@rbxts/topbar-plus";

import { enterGalaxy } from "game/Planets/client/galaxy-camera";
import {
	composingAtom,
	deployedAtom,
	selectedPlanetAtom,
	starMapIconAtom,
	starMapOpenAtom,
	worldStateAtom,
} from "game/Planets/client/planets-state";
import { playTravel } from "game/Planets/client/travel-cutscene";
import { PlanetsMessage, planetsMessaging } from "game/Planets/shared/planets-network";
import { unlockedAtom } from "game/Tutorial/client/tutorial-state";

const BLOCK_MOVEMENT = "StarMapBlockMovement";
/** The keys the character walks and jumps with, which the star map takes over. */
const MOVEMENT_KEYS = [
	Enum.KeyCode.W,
	Enum.KeyCode.A,
	Enum.KeyCode.S,
	Enum.KeyCode.D,
	Enum.KeyCode.Up,
	Enum.KeyCode.Down,
	Enum.KeyCode.Left,
	Enum.KeyCode.Right,
	Enum.KeyCode.Space,
];

/**
 * Keeps the planet atoms in sync with the server and decides who has the camera.
 * Until the local player deploys, and whenever they open the star map after (M
 * or the topbar button), it's the star map's: it flies up to the map, where the
 * player can orbit, pan and zoom, and back down to the character after. While
 * the team travels, it's the cutscene's. `GameApp` draws the map and the panels.
 */
@Controller()
export class PlanetsController implements OnStart {
	onStart() {
		const player = Players.LocalPlayer;

		planetsMessaging.client.on(PlanetsMessage.State, (state) => worldStateAtom(state));
		player.CharacterAdded.Connect(() => deployedAtom(true));
		if (player.Character) deployedAtom(true);
		planetsMessaging.server.emit(PlanetsMessage.Request);

		// The stage alone, so a fresh WorldState with the same stage doesn't restart the cutscene.
		const travelStage = computed(() => (deployedAtom() ? worldStateAtom()?.travel?.stage : undefined));
		const canOpen = computed(() => deployedAtom() && travelStage() === undefined);
		// On the ground the tutorial holds the map back till its last step, unless a planet is already liberated
		// (a veteran needs it to retreat). Closing it is always allowed.
		const canToggle = computed(
			() =>
				canOpen() &&
				(starMapOpenAtom() || unlockedAtom("starMap") || (worldStateAtom()?.conquered.size() ?? 0) > 0),
		);
		const toggle = () => {
			if (canToggle()) starMapOpenAtom(!starMapOpenAtom());
		};

		// Travelling closes the map; the cutscene has the camera.
		effect(() => {
			if (!canOpen()) starMapOpenAtom(false);
		});
		effect(() => {
			if (!starMapOpenAtom()) composingAtom(undefined);
		});

		// Opening the map from the ground starts on the planet the team is on.
		subscribe(starMapOpenAtom, (open) => {
			const active = worldStateAtom()?.active;
			if (open && active !== undefined) selectedPlanetAtom(active);
		});

		// Not deselected by the HUD button: it's the map's own state.
		const icon = new Icon().setLabel("Star Map").autoDeselect(false).setEnabled(false);
		starMapIconAtom(icon.getInstance("IconButton") as GuiObject);
		icon.toggled.Connect((selected) => {
			if (selected !== starMapOpenAtom()) toggle();
		});
		effect(() => {
			icon.setEnabled(canToggle());
			if (starMapOpenAtom()) icon.select();
			else icon.deselect();
		});

		UserInputService.InputBegan.Connect((input, processed) => {
			if (!processed && input.KeyCode === Enum.KeyCode.M) toggle();
		});

		// While the map is open WASD pans it, so the character mustn't walk off too, or fire at the map.
		effect(() => {
			if (!starMapOpenAtom()) return;
			untracked(() => player.Character?.FindFirstChildOfClass("Humanoid")?.UnequipTools());
			ContextActionService.BindActionAtPriority(
				BLOCK_MOVEMENT,
				() => Enum.ContextActionResult.Sink,
				false,
				Enum.ContextActionPriority.High.Value,
				...MOVEMENT_KEYS,
			);
			return () => ContextActionService.UnbindAction(BLOCK_MOVEMENT);
		});

		// Exactly one owner for the camera at a time. Each one's cleanup flies it back to the character,
		// and the next owner, if any, takes it straight over.
		const mode = computed(() => {
			if (!worldStateAtom()) return undefined;
			return travelStage() ?? (!deployedAtom() || starMapOpenAtom() ? "galaxy" : undefined);
		});
		effect(() => {
			const current = mode();
			if (current === undefined) return;
			return untracked(() => {
				const travel = worldStateAtom()?.travel;
				return current === "galaxy" || !travel ? enterGalaxy() : playTravel(travel);
			});
		});
	}
}
