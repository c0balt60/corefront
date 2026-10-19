import { Controller, OnStart } from "@flamework/core";
import { effect, untracked } from "@rbxts/charm";
import { Players, Workspace } from "@rbxts/services";

import { playerDataAtom } from "core/Data/client/data-state";
import { COLORS } from "core/Interface/client/theme";
import { generateStarSystem, type Planet } from "core/Worlds/shared/star-system";
import {
	amountOf,
	baseStateAtom,
	buildModeAtom,
	equippedAtom,
	isPlayerBuilding,
	notify,
	toolsAtom,
} from "game/Base/client/base-state";
import { ghostPart } from "game/Base/client/BuildController";
import {
	BUILD_CATEGORIES,
	BUILD_TOOL,
	type BuildableKind,
	type BuildingKind,
	isCore,
} from "game/Base/shared/buildings";
import { isBlaster } from "game/Base/shared/blasters";
import { RESOURCES } from "game/Base/shared/resources";
import {
	deployedAtom,
	selectedPlanetAtom,
	starMapIconAtom,
	starMapOpenAtom,
	worldStateAtom,
} from "game/Planets/client/planets-state";
import type { WorldState } from "game/Planets/shared/planets-network";
import { levelsAtom, researchIconAtom, researchOpenAtom } from "game/Research/client/research-state";
import { RESEARCH } from "game/Research/shared/research";
import {
	beltReaches,
	clearGuide,
	drawLine,
	drawSpot,
	freeOre,
	groundAt,
	planBelt,
	turretSpot,
} from "game/Tutorial/client/tutorial-guide";
import { type TutorialHint, tutorialHintAtom, tutorialProgressAtom } from "game/Tutorial/client/tutorial-state";
import { TUTORIAL_DONE, TUTORIAL_STEPS } from "game/Tutorial/shared/tutorial";
import { TutorialMessage, tutorialMessaging } from "game/Tutorial/shared/tutorial-network";

/** Seconds between looks at the world, which no atom reports. */
const POLL = 0.25;
/** How tall the practice aliens' marker stands. */
const BEACON_HEIGHT = 80;
/** Seconds to wait for the server to move on after an `Advance` before sending it again. */
const RETRY = 3;

/** A hint before its interface target has been found: a `gui` already in hand, or the ScreenGui to look in and names to look for, best first. */
type Draft = Omit<TutorialHint, "step"> & { readonly root?: string; readonly names?: ReadonlyArray<string> };
/** What to say and point at, for a step that wants a tool, then a building picked. */
type Aim = Pick<Draft, "text" | "root" | "names">;

/** The models in `Workspace.Base.<folder>`: `Buildings` or `Aliens`. Enemy and derelict buildings are left out: none are the player's to use. */
function modelsIn(folder: string) {
	const children = Workspace.FindFirstChild("Base")?.FindFirstChild(folder)?.GetChildren() ?? [];
	return children.filter((child): child is Model => child.IsA("Model") && isPlayerBuilding(child));
}

/** The buildings of `kind`, oldest first. */
function buildingsOf(kind: BuildingKind) {
	return modelsIn("Buildings").filter((building) => building.GetAttribute("Kind") === kind);
}

/** The one nearest `from`, the local character by default. */
function nearest(models: ReadonlyArray<Model>, from = Players.LocalPlayer.Character?.GetPivot().Position) {
	if (!from) return undefined;
	let best: Model | undefined;
	let bestDistance = math.huge;
	for (const model of models) {
		const distance = model.GetPivot().Position.sub(from).Magnitude;
		if (distance < bestDistance) [best, bestDistance] = [model, distance];
	}
	return best;
}

/** `gui` if it is on screen: it and every interface object above it visible, and not empty. */
function shown(gui: GuiObject | undefined) {
	if (!gui || gui.AbsoluteSize.X <= 0 || gui.AbsoluteSize.Y <= 0) return undefined;
	for (let at: Instance | undefined = gui; at?.IsA("GuiObject"); at = at.Parent) if (!at.Visible) return undefined;
	return gui;
}

/** What to tell the player to press to take out `tool`. */
function takeOut(tool: string, label: string): Aim {
	const slot = toolsAtom().findIndex((other) => other.Name === tool) + 1;
	return {
		text: slot > 0 ? `Press ${slot} to take out ${label}` : `Take out ${label}`,
		root: "BaseHud",
		names: [`Slot_${tool}`],
	};
}

/** Takes out the Build tool, then picks `kind`: what's left to do, or `undefined` once it is picked. */
function pick(kind: BuildableKind, label: string): Aim | undefined {
	if (equippedAtom()?.Name !== BUILD_TOOL) return takeOut(BUILD_TOOL, "the Build tool");
	if (buildModeAtom() === kind) return undefined;
	const category = BUILD_CATEGORIES.find((other) => other.kinds.includes(kind))!;
	// Its tile only shows while its category is open, so the category's is the next best.
	return {
		text: `Pick the ${label} in the build bar`,
		root: "BaseHud",
		names: [`Build_${kind}`, `Category_${category.name}`],
	};
}

function same(a: TutorialHint | undefined, b: TutorialHint | undefined) {
	return (
		a === b ||
		(a !== undefined &&
			b !== undefined &&
			a.step === b.step &&
			a.title === b.title &&
			a.text === b.text &&
			a.progress === b.progress &&
			a.gui === b.gui &&
			a.world === b.world)
	);
}

/**
 * Walks the local player through the tutorial while it isn't done (see `TUTORIAL_STEPS`): sends `Advance` as it
 * sees each step finished (bar the ones the server finishes itself), and keeps `tutorialHintAtom` on what to do next and what to point at. `GameApp` draws it.
 * Most of the world isn't in an atom, so it looks again every `POLL` seconds as well as when an atom changes.
 */
@Controller()
export class TutorialController implements OnStart {
	private playerGui!: Instance;
	/** The step the counts below were taken at, and the last one `Advance` was sent for. */
	private step = -1;
	private sent = -1;
	private sentAt = 0;
	/** Whether the base and its buildings have arrived, so the counts below are real. */
	private based = false;
	private drills = 0;
	private turrets = 0;
	/** Whether this look at the world put the guide on the ground, which it is taken off of if not. */
	private guided = false;
	private planet: number | undefined;
	/** The interface targets found so far, by name. */
	private readonly found = new Map<string, GuiObject>();
	/** The practice aliens' landing marker, and the spot it was made for. */
	private beacon: Part | undefined;
	private spot: Vector3 | undefined;
	private system: { readonly seed: number; readonly planets: ReadonlyArray<Planet> } | undefined;

	onStart() {
		this.playerGui = Players.LocalPlayer.WaitForChild("PlayerGui");
		effect(() => this.tick());
		task.spawn(() => {
			while (true) {
				task.wait(POLL);
				untracked(() => this.tick());
			}
		});
	}

	private tick() {
		const progress = tutorialProgressAtom();
		// Until both have arrived the progress is only a guess: a sandbox would flash a hint.
		if (!playerDataAtom() || !baseStateAtom()) return;

		if (progress >= TUTORIAL_DONE) {
			if (this.step === TUTORIAL_DONE - 1) task.defer(() => notify("Tutorial complete", "research"));
			this.step = progress;
			clearGuide();
			this.mark(undefined);
			tutorialHintAtom(undefined);
			return;
		}
		if (progress !== this.step) this.begin(progress);
		else if (!this.based) this.count();

		// The server's update comes back a moment later, so not again till it has had its time.
		if ((this.sent !== progress || os.clock() - this.sentAt > RETRY) && this.done()) {
			this.sent = progress;
			this.sentAt = os.clock();
			tutorialMessaging.server.emit(TutorialMessage.Advance, { step: progress });
		}

		this.guided = false;
		const draft = this.draft();
		if (!this.guided) clearGuide();
		const { title, text, world } = draft;
		const hint: TutorialHint = {
			step: progress,
			title,
			text,
			progress: draft.progress,
			gui: draft.gui ?? this.find(draft.root, draft.names),
			world,
		};
		if (!same(tutorialHintAtom(), hint)) tutorialHintAtom(hint);
	}

	/** A column over `spot` on the ground there, or `undefined` to take it down. Not made until the ground is there to land on. */
	private mark(spot: Vector3 | undefined) {
		if (spot !== undefined && spot === this.spot) return this.beacon;
		this.beacon?.Parent?.Destroy();
		this.beacon = undefined;
		this.spot = undefined;
		if (spot === undefined) return undefined;

		const ground = groundAt(spot.X, spot.Z);
		if (ground === undefined) return undefined;
		const folder = new Instance("Folder");
		folder.Name = "TutorialMarker";
		const beacon = ghostPart(folder, new Vector3(4, BEACON_HEIGHT, 4));
		beacon.Color = COLORS.danger;
		beacon.Transparency = 0.5;
		beacon.Position = new Vector3(spot.X, ground + BEACON_HEIGHT / 2, spot.Z);
		folder.Parent = Workspace;
		this.beacon = beacon;
		this.spot = spot;
		return beacon;
	}

	/** What to say and point at to belt `from` into `to`: `text` for one drag along the marked line, else a route. */
	private beltAim(from: Model | undefined, to: Model | undefined, text: string): Pick<Draft, "text" | "world"> {
		const plan = from && to && planBelt(from, to);
		if (!plan) return { text };
		this.guided = true;
		return {
			text: plan.single ? text : "Follow the marked tiles: drag along each straight stretch",
			world: drawLine(plan.line),
		};
	}

	/** Marks `cell` on the ground and returns its pad. */
	private padAt(cell: number | undefined) {
		if (cell === undefined) return undefined;
		this.guided = true;
		return drawSpot(cell);
	}

	/** Takes what the steps that count things count from, once the buildings are there to count. */
	private begin(step: number) {
		this.step = step;
		this.sent = -1;
		this.based = false;
		this.mark(undefined);
		this.count();
		this.planet = worldStateAtom()?.active;
	}

	private count() {
		this.based =
			Workspace.FindFirstChild("Base")?.FindFirstChild("Buildings") !== undefined &&
			baseStateAtom() !== undefined;
		if (!this.based) return;
		this.drills = buildingsOf("drill").size();
		this.turrets = buildingsOf("turret").size();
	}

	private done() {
		const world = worldStateAtom();
		switch (TUTORIAL_STEPS[this.step]) {
			case "deploy":
				return deployedAtom();
			case "drill":
				return this.based && buildingsOf("drill").size() > this.drills;
			case "conveyor": {
				const core = modelsIn("Buildings").find((building) => isCore(building.GetAttribute("Kind")));
				return core !== undefined && buildingsOf("drill").some((drill) => beltReaches(drill, core));
			}
			case "research": {
				const researched = (levelsAtom().turret ?? 0) >= 1;
				// Out of the way of the turret step.
				if (researched) researchOpenAtom(false);
				return researched;
			}
			case "turret":
				return this.based && buildingsOf("turret").size() > this.turrets;
			case "ammo": {
				const turret = nearest(buildingsOf("turret"));
				return turret !== undefined && buildingsOf("drill").some((drill) => beltReaches(drill, turret));
			}
			case "defend":
				return world?.active !== undefined && world.conquered.includes(world.active);
			case "travel":
				return (
					world?.plan !== undefined ||
					world?.travel !== undefined ||
					(world?.active !== undefined && world.active !== this.planet)
				);
			default:
				// The shoot step, which the server finishes itself.
				return false;
		}
	}

	/** What to say and point at for the step the player is on. */
	private draft(): Draft {
		const pool = baseStateAtom()?.pool ?? [];
		switch (TUTORIAL_STEPS[this.step]) {
			case "deploy":
				return {
					title: "DEPLOY",
					text: "Select a planet and press DEPLOY",
					root: "GameApp",
					names: ["PlanetAction"],
				};
			case "drill": {
				// Nearest the Core, not the player, so a belt to it fits in one drag.
				const core = modelsIn("Buildings").find((building) => isCore(building.GetAttribute("Kind")));
				return {
					title: "BUILD A DRILL",
					...(pick("drill", "Drill") ?? {
						text: "Place the drill on the marked copper deposit",
						world: core && freeOre(core.GetPivot().Position),
					}),
				};
			}
			case "conveyor": {
				const core = modelsIn("Buildings").find((building) => isCore(building.GetAttribute("Kind")));
				return {
					title: "CONNECT THE CORE",
					progress: `Core copper ${amountOf(pool, "copper")}`,
					...(pick("conveyor", "Conveyor") ??
						this.beltAim(
							nearest(buildingsOf("drill")),
							core,
							"Press on the first marked tile by the drill, drag to the last one by the Core and let go. Belts carry ore the way you drag.",
						)),
				};
			}
			case "shoot": {
				const alien = nearest(modelsIn("Aliens"));
				// The server marks where they land, and sends them once the Blaster is out.
				const beacon = this.mark(
					alien ? undefined : (Players.LocalPlayer.GetAttribute("TutorialSpawn") as Vector3 | undefined),
				);
				const aim = !isBlaster(equippedAtom())
					? takeOut(toolsAtom().find(isBlaster)?.Name ?? "Blaster", "your Blaster")
					: { text: alien ? "Shoot the aliens" : "Aliens incoming, shoot them" };
				return {
					title: "SHOOT THE ALIENS",
					...aim,
					text: beacon && !alien ? `${aim.text}. Aliens land at the marker` : aim.text,
					world: alien ?? beacon,
				};
			}
			case "research": {
				const text = "Research costs Core resources. ";
				return {
					title: "RESEARCH THE TURRET",
					progress: RESEARCH.turret.cost
						.map(
							(cost) =>
								`${RESOURCES[cost.resource].name} ${amountOf(pool, cost.resource)}/${cost.amount}`,
						)
						.join(" · "),
					...(researchOpenAtom()
						? { text: `${text}Pick the Turret and research it`, root: "Research", names: ["Node_turret"] }
						: {
								text: `${text}Press T or click Research in the top bar`,
								gui: shown(researchIconAtom()),
							}),
				};
			}
			case "turret": {
				const core = modelsIn("Buildings").find((building) => isCore(building.GetAttribute("Kind")));
				return {
					title: "BUILD A TURRET",
					...(pick("turret", "Turret") ?? {
						text: "Place the turret on the marked spot. Aliens come from this direction.",
						world: (core && this.padAt(turretSpot(core))) ?? core,
					}),
				};
			}
			case "ammo": {
				const core = modelsIn("Buildings").find((building) => isCore(building.GetAttribute("Kind")));
				const turret = nearest(buildingsOf("turret"));
				const at = turret?.GetPivot().Position;
				// The drill for it is one the Core isn't already fed by.
				const drill = nearest(
					buildingsOf("drill").filter((other) => !core || !beltReaches(other, core)),
					at,
				);
				const title = "LOAD THE TURRET";
				// A drill of its own first, on the copper nearest the turret, then a belt from it.
				if (!drill) {
					return {
						title,
						...(pick("drill", "Drill") ?? {
							text: "Turrets need ammo. Build a drill on the marked copper",
							world: at && freeOre(at),
						}),
					};
				}
				return {
					title,
					...(pick("conveyor", "Conveyor") ?? this.beltAim(drill, turret, "Belt its copper into the turret")),
				};
			}
			case "defend": {
				const base = baseStateAtom();
				// No wave is coming while the server holds them for someone still learning.
				const held = base?.wave === 0 && base.nextWaveAt === 0;
				return {
					title: "DEFEND THE PLANET",
					text: held
						? "Waiting for teammates to finish the tutorial. Press CALL WAVE to start the first wave."
						: "Your defences are ready. The first wave lands in a minute. Survive every wave to liberate the planet. CALL WAVE sends the next one early.",
					progress: base && `Wave ${base.wave}/${base.waves}`,
				};
			}
			default:
				return this.travel(worldStateAtom());
		}
	}

	private travel(world: WorldState | undefined): Draft {
		const title = "TRAVEL ON";
		if (!starMapOpenAtom()) {
			return { title, text: "Press M or click Star Map in the top bar", gui: shown(starMapIconAtom()) };
		}
		const open = (planet: number) => world?.unlocked.includes(planet) && !world.conquered.includes(planet);
		if (open(selectedPlanetAtom())) {
			return { title, text: "PLAN LAUNCH, then get everyone ready", root: "GameApp", names: ["PlanetAction"] };
		}
		const target = world?.unlocked.find(open);
		if (world && this.system?.seed !== world.seed) {
			this.system = { seed: world.seed, planets: generateStarSystem(world).planets };
		}
		const name = target !== undefined ? this.system?.planets[target]?.name : undefined;
		const body = name !== undefined ? Workspace.FindFirstChild("StarMap")?.FindFirstChild(name) : undefined;
		return { title, text: "Select the next planet", world: body?.IsA("BasePart") ? body : undefined };
	}

	/** The first of `names` under `root` that is on screen. A target not found yet is looked for again each poll. */
	private find(root: string | undefined, names: ReadonlyArray<string> | undefined) {
		if (root === undefined || names === undefined) return undefined;
		for (const name of names) {
			let gui = this.found.get(name);
			// The hotbar reuses its slots, renaming them, so a name can move on to another object.
			if (!gui?.IsDescendantOf(this.playerGui) || gui.Name !== name) {
				this.found.delete(name);
				gui = this.playerGui.FindFirstChild(root)?.FindFirstChild(name, true) as GuiObject | undefined;
				if (gui) this.found.set(name, gui);
			}
			if (shown(gui)) return gui;
		}
		return undefined;
	}
}
