import { createSpring } from "@rbxts/ripple";
import { Players, RunService, UserInputService } from "@rbxts/services";

import { generateStarSystem, type Planet } from "core/Worlds/shared/star-system";
import { ORIGIN, planetPosition } from "game/Planets/client/components/star-map";
import { hoveredPlanetAtom, selectedPlanetAtom, worldStateAtom } from "game/Planets/client/planets-state";

const CAMERA_STEP = "GalaxyCamera";
/** Slow, for flying the thousand studs between the ground and the map. */
const FLIGHT_SPRING = { tension: 45, friction: 14 };
/** Quicker, once the camera has reached the map, so dragging feels direct but never jerky. */
const ORBIT_SPRING = { tension: 140, friction: 24 };

/** The overview the camera starts on and `R` returns to: tilted over the star, from 140 up and 100 back. */
const HOME_PITCH = math.atan2(140, 100);
const HOME_DISTANCE = new Vector3(0, 140, 100).Magnitude;
const MIN_DISTANCE = 25;
const MAX_DISTANCE = 320;
/** How close a planet click brings the camera, when it's further out than this. */
const FOCUS_DISTANCE = 70;
const MIN_PITCH = math.rad(10);
const MAX_PITCH = math.rad(85);
/** How far from the star the focus may be panned, in studs: just past the outermost orbit. */
const PAN_LIMIT = 150;
/**
 * How far the camera slides left, as a fraction of its distance, so what it
 * looks at sits right of centre, clear of the planet panel.
 */
const SHIFT = 0.29;

/** Radians per pixel dragged. */
const DRAG_ROTATE = 0.006;
/** Distances panned per pixel dragged, so panning feels the same at any zoom. */
const DRAG_PAN = 0.002;
/** Radians and distances per second while a key is held. */
const KEY_ROTATE = 1.6;
const KEY_PAN = 1.1;
/** How much one scroll notch keeps of the distance. */
const ZOOM_STEP = 0.88;
/** Pixels a press may move and still count as a click (or tap) instead of a drag. */
const CLICK_SLOP = 6;
/** Pixels round a planet's disc that still pick it. */
const PICK_PADDING = 16;

/** Where Roblox's default camera sits behind a character, so handing the camera back to it does not snap. */
const FOLLOW_DISTANCE = 12.5;
const FOLLOW_FOCUS = new Vector3(0, 1.5, 0);
/** Seconds the camera may take to settle behind a character before it is handed back regardless. */
const FOLLOW_SECONDS = 3;

/** The one spring that carries the camera, stepped from a render step. */
const cameraSpring = createSpring(new CFrame(), FLIGHT_SPRING);

// The orbit the camera springs towards. While `following` is set, it orbits that planet instead of `focus`.
let focus = ORIGIN;
let yaw = 0;
let pitch = HOME_PITCH;
let distance = HOME_DISTANCE;
let following: number | undefined;

let cachedSeed: number | undefined;
let cachedPlanets: readonly Planet[] = [];

/** The current world's planets, generated once per seed. */
function planets() {
	const seed = worldStateAtom()?.seed;
	if (seed !== cachedSeed) {
		cachedSeed = seed;
		cachedPlanets = seed !== undefined ? generateStarSystem(seed).planets : [];
	}
	return cachedPlanets;
}

/** What the camera orbits: the followed planet as it drifts, or the panned focus. */
function target() {
	const planet = following !== undefined ? planets()[following] : undefined;
	return planet ? planetPosition(planet) : focus;
}

function orbitPose() {
	const centre = target();
	const offset = new Vector3(math.sin(yaw) * math.cos(pitch), math.sin(pitch), math.cos(yaw) * math.cos(pitch)).mul(
		distance,
	);
	return CFrame.lookAt(centre.add(offset), centre).mul(new CFrame(-SHIFT * distance, 0, 0));
}

function rotate(delta: Vector2) {
	yaw -= delta.X * DRAG_ROTATE;
	pitch = math.clamp(pitch + delta.Y * DRAG_ROTATE, MIN_PITCH, MAX_PITCH);
}

/** Moves the focus across the plane of the system, in studs right and forward of the camera. Stops following. */
function pan(right: number, forward: number) {
	focus = target();
	following = undefined;

	const rightward = new Vector3(math.cos(yaw), 0, -math.sin(yaw));
	const forwards = new Vector3(-math.sin(yaw), 0, -math.cos(yaw));
	const offset = focus.add(rightward.mul(right)).add(forwards.mul(forward)).sub(ORIGIN);
	focus = ORIGIN.add(offset.Magnitude > PAN_LIMIT ? offset.Unit.mul(PAN_LIMIT) : offset);
}

/** Pans as if grabbing the plane: dragging right slides the system right. */
function dragPan(delta: Vector2) {
	pan(-delta.X * DRAG_PAN * distance, delta.Y * DRAG_PAN * distance);
}

function zoom(factor: number) {
	distance = math.clamp(distance * factor, MIN_DISTANCE, MAX_DISTANCE);
}

/** Back to the overview the camera started on. */
function reset() {
	focus = ORIGIN;
	yaw = 0;
	pitch = HOME_PITCH;
	distance = HOME_DISTANCE;
	following = undefined;
}

/** Selects a planet, locked or not, and flies the camera over to follow it round its orbit until the player pans away. */
export function focusPlanet(index: number) {
	selectedPlanetAtom(index);
	following = index;
	distance = math.min(distance, FOCUS_DISTANCE);
}

/** The planet drawn under `point` (screen pixels, like `InputObject.Position`), forgiving by `PICK_PADDING`. */
function pick(camera: Camera, point: Vector2) {
	const halfFov = math.rad(camera.FieldOfView / 2);
	let picked: number | undefined;
	let nearest = math.huge;

	planets().forEach((planet, index) => {
		const [screen, visible] = camera.WorldToScreenPoint(planetPosition(planet));
		if (!visible) return;

		// The planet's radius in pixels, from its depth and the camera's vertical field of view.
		const radius = (planet.size / 2 / (screen.Z * math.tan(halfFov))) * (camera.ViewportSize.Y / 2);
		const away = new Vector2(screen.X, screen.Y).sub(point).Magnitude;
		if (away < radius + PICK_PADDING && away < nearest) {
			picked = index;
			nearest = away;
		}
	});
	return picked;
}

const flat = (vector: Vector3) => new Vector2(vector.X, vector.Y);

/**
 * Mouse, touch and keyboard controls for the star map. Mouse: left or right
 * drag rotates, middle drag pans, the wheel zooms, a click picks a planet.
 * Touch: one finger rotates, two pan and pinch, a tap picks. Keys: WASD or the
 * arrows pan, Q and E rotate, R resets. Returns a function that unbinds them.
 */
function bindControls(camera: Camera) {
	const connections = new Array<RBXScriptConnection>();
	// The mouse button held down, how far the mouse has moved since, and where it was last.
	let button: Enum.UserInputType | undefined;
	let travelled = 0;
	let last = Vector2.zero;
	// Every finger on the screen and where it was last, and how far the gesture has moved in all.
	const touches = new Map<InputObject, Vector2>();
	let swiped = 0;

	connections.push(
		UserInputService.InputBegan.Connect((input, processed) => {
			if (processed) return;
			const kind = input.UserInputType;

			if (
				kind === Enum.UserInputType.MouseButton1 ||
				kind === Enum.UserInputType.MouseButton2 ||
				kind === Enum.UserInputType.MouseButton3
			) {
				button = kind;
				travelled = 0;
				last = flat(input.Position);
			} else if (kind === Enum.UserInputType.Touch) {
				if (touches.size() === 0) swiped = 0;
				touches.set(input, flat(input.Position));
			} else if (input.KeyCode === Enum.KeyCode.R) {
				reset();
			}
		}),

		UserInputService.InputChanged.Connect((input, processed) => {
			const kind = input.UserInputType;

			if (kind === Enum.UserInputType.MouseMovement) {
				const position = flat(input.Position);
				// If something has locked the mouse, it stays put and only `Delta` says how far it moved.
				const delta =
					UserInputService.MouseBehavior === Enum.MouseBehavior.Default
						? position.sub(last)
						: flat(input.Delta);
				last = position;

				if (button) {
					travelled += delta.Magnitude;
					if (travelled <= CLICK_SLOP) return;
					if (button === Enum.UserInputType.MouseButton3) dragPan(delta);
					else rotate(delta);
				} else {
					hoveredPlanetAtom(processed ? undefined : pick(camera, position));
				}
			} else if (kind === Enum.UserInputType.MouseWheel && !processed) {
				zoom(ZOOM_STEP ** input.Position.Z);
			} else if (kind === Enum.UserInputType.Touch) {
				const previous = touches.get(input);
				if (!previous) return;
				const position = flat(input.Position);
				touches.set(input, position);
				swiped += position.sub(previous).Magnitude;

				if (touches.size() === 1) {
					rotate(position.sub(previous));
				} else if (touches.size() === 2) {
					let other = position;
					touches.forEach((point, touch) => {
						if (touch !== input) other = point;
					});
					// Two fingers: pan by half this finger's move (the other moves the rest), zoom by the pinch.
					dragPan(position.sub(previous).div(2));
					const before = previous.sub(other).Magnitude;
					const after = position.sub(other).Magnitude;
					if (before > 0 && after > 0) zoom(before / after);
				}
			}
		}),

		UserInputService.InputEnded.Connect((input) => {
			const kind = input.UserInputType;

			if (kind === button) {
				if (kind === Enum.UserInputType.MouseButton1 && travelled <= CLICK_SLOP) {
					const picked = pick(camera, flat(input.Position));
					if (picked !== undefined) focusPlanet(picked);
				}
				button = undefined;
			} else if (kind === Enum.UserInputType.Touch && touches.has(input)) {
				touches.delete(input);
				if (touches.size() === 0 && swiped <= CLICK_SLOP) {
					const picked = pick(camera, flat(input.Position));
					if (picked !== undefined) focusPlanet(picked);
				}
			}
		}),
	);

	return () => {
		connections.forEach((connection) => connection.Disconnect());
		hoveredPlanetAtom(undefined);
	};
}

/** Pans and rotates by the keys held this frame. */
function steerKeys(dt: number) {
	if (UserInputService.GetFocusedTextBox()) return;
	const held = (...keys: Enum.KeyCode[]) => (keys.some((key) => UserInputService.IsKeyDown(key)) ? 1 : 0);

	const right = held(Enum.KeyCode.D, Enum.KeyCode.Right) - held(Enum.KeyCode.A, Enum.KeyCode.Left);
	const forward = held(Enum.KeyCode.W, Enum.KeyCode.Up) - held(Enum.KeyCode.S, Enum.KeyCode.Down);
	if (right !== 0 || forward !== 0) pan(right * KEY_PAN * distance * dt, forward * KEY_PAN * distance * dt);
	yaw += (held(Enum.KeyCode.Q) - held(Enum.KeyCode.E)) * KEY_ROTATE * dt;
}

/**
 * Takes the camera over and flies it from wherever it is to the star map, then
 * hands the player the controls. Returns a function that gives the controls
 * back and flies the camera down behind the character once it spawns.
 */
export function enterGalaxy(camera: Camera) {
	reset();
	camera.CameraType = Enum.CameraType.Scriptable;
	cameraSpring.configure(FLIGHT_SPRING);
	cameraSpring.setPosition(camera.CFrame);
	cameraSpring.halt();

	const unbind = bindControls(camera);
	let arrived = false;

	RunService.UnbindFromRenderStep(CAMERA_STEP);
	RunService.BindToRenderStep(CAMERA_STEP, Enum.RenderPriority.Camera.Value + 1, (dt) => {
		steerKeys(dt);
		const goal = orbitPose();
		cameraSpring.setGoal(goal);
		camera.CFrame = cameraSpring.step(dt);

		if (!arrived && camera.CFrame.Position.sub(goal.Position).Magnitude < 1) {
			arrived = true;
			cameraSpring.configure(ORBIT_SPRING);
		}
	});

	return () => {
		unbind();
		leaveGalaxy(camera);
	};
}

/** Where Roblox's default camera would put itself behind the local character, or `undefined` while there is none. */
function followPose() {
	const root = Players.LocalPlayer.Character?.FindFirstChild("HumanoidRootPart") as BasePart | undefined;
	if (!root) return undefined;

	const centre = root.Position.add(FOLLOW_FOCUS);
	return CFrame.lookAt(centre.sub(root.CFrame.LookVector.mul(FOLLOW_DISTANCE)), centre);
}

/** Flies the camera down behind the character, then hands it back to Roblox once there or after `FOLLOW_SECONDS`. */
function leaveGalaxy(camera: Camera) {
	const startedAt = os.clock();
	cameraSpring.configure(FLIGHT_SPRING);

	RunService.UnbindFromRenderStep(CAMERA_STEP);
	RunService.BindToRenderStep(CAMERA_STEP, Enum.RenderPriority.Camera.Value + 1, (dt) => {
		const goal = followPose();
		if (goal) {
			cameraSpring.setGoal(goal);
			camera.CFrame = cameraSpring.step(dt);
		}

		const arrived = goal !== undefined && camera.CFrame.Position.sub(goal.Position).Magnitude < 0.5;
		if (arrived || os.clock() - startedAt > FOLLOW_SECONDS) {
			RunService.UnbindFromRenderStep(CAMERA_STEP);
			camera.CameraType = Enum.CameraType.Custom;
		}
	});
}
