import { RunService, Workspace } from "@rbxts/services";

import { isCore } from "game/Base/shared/buildings";
import { CAMERA_STEP, followCharacter } from "game/Planets/client/galaxy-camera";
import { LAND_SECONDS, LAUNCH_SECONDS, type Travel } from "game/Planets/shared/planets-network";

/** Seconds the core rumbles on the pad before it lifts off. */
const RUMBLE_SECONDS = 1;
/** Studs the core has climbed when the launch ends. */
const RISE = 260;
/** Studs above the landing the core comes down from, and the seconds it takes: the landing, less a beat on the ground. */
const DROP = 300;
const FALL_SECONDS = LAND_SECONDS - 1.5;
/** Where the camera watches from, relative to the core on the ground. */
const LAUNCH_VIEW = new Vector3(0, 14, 46);
const LAND_VIEW = new Vector3(0, 26, 64);

const random = new Random();

function findCore(): Model | undefined {
	const buildings = Workspace.FindFirstChild("Base")?.FindFirstChild("Buildings");
	return buildings?.GetChildren().find((child) => isCore(child.GetAttribute("Kind"))) as Model | undefined;
}

/**
 * A local copy of the core's body (everything but its foundation) with thruster
 * flames, for the cutscene to fly, while the real one is hidden on this client.
 * Returns the copy and a function that removes it and shows the real one again.
 */
function standIn(core: Model): [copy: Model, restore: () => void] {
	const copy = new Instance("Model");
	const hidden = new Array<BasePart>();
	for (const part of core.GetChildren()) {
		if (!part.IsA("BasePart") || part.Name === "Foundation") continue;
		hidden.push(part);
		part.LocalTransparencyModifier = 1;
		const clone = part.Clone();
		// Drops the welds; every piece is anchored and moved together.
		clone.ClearAllChildren();
		clone.Anchored = true;
		clone.CanCollide = false;
		clone.Parent = copy;
		if (part === core.PrimaryPart) copy.PrimaryPart = clone;
	}
	if (copy.PrimaryPart) {
		const fire = new Instance("Fire");
		fire.Size = 14;
		fire.Heat = -25;
		fire.Parent = copy.PrimaryPart;
		const smoke = new Instance("Smoke");
		smoke.RiseVelocity = -10;
		smoke.Parent = copy.PrimaryPart;
	}
	copy.Parent = Workspace;

	return [
		copy,
		() => {
			copy.Destroy();
			for (const part of hidden) part.LocalTransparencyModifier = 0;
		},
	];
}

/** Binds `frame` to the camera's render step with the time since it started, on whichever camera is current. */
function drive(frame: (camera: Camera, elapsed: number) => void) {
	const startedAt = os.clock();
	RunService.UnbindFromRenderStep(CAMERA_STEP);
	RunService.BindToRenderStep(CAMERA_STEP, Enum.RenderPriority.Camera.Value + 1, () => {
		const camera = Workspace.CurrentCamera;
		if (!camera) return;
		camera.CameraType = Enum.CameraType.Scriptable;
		frame(camera, os.clock() - startedAt);
	});
}

/** The core rumbles, then climbs away on its flames while the camera watches from beside the pad. */
function launch() {
	const core = findCore();
	if (!core) return () => {};
	const [copy, restore] = standIn(core);
	const pad = copy.GetPivot();
	const view = pad.Position.add(LAUNCH_VIEW);

	drive((camera, elapsed) => {
		const climb = math.max(elapsed - RUMBLE_SECONDS, 0) / (LAUNCH_SECONDS - RUMBLE_SECONDS);
		const shake = elapsed < RUMBLE_SECONDS + 0.5 ? 0.3 : 0.1;
		const jitter = new Vector3(random.NextNumber(-shake, shake), 0, random.NextNumber(-shake, shake));
		copy.PivotTo(pad.add(new Vector3(0, RISE * climb ** 2, 0)).add(jitter));
		camera.CFrame = CFrame.lookAt(view.add(jitter.mul(0.5)), copy.GetPivot().Position);
	});
	return restore;
}

/** The core drops out of the sky onto the landing, slowing as it nears the ground, and touches down in a burst. */
function land() {
	let restore: (() => void) | undefined;
	let copy: Model | undefined;
	let pad: CFrame | undefined;
	let landed = false;

	drive((camera, elapsed) => {
		// The new base may reach this client a moment after the stage does.
		if (!copy) {
			const core = findCore();
			if (!core) return;
			[copy, restore] = standIn(core);
			pad = copy.GetPivot();
		}
		const fall = math.min(elapsed / FALL_SECONDS, 1);
		copy.PivotTo(pad!.add(new Vector3(0, DROP * (1 - fall) ** 2, 0)));
		camera.CFrame = CFrame.lookAt(pad!.Position.add(LAND_VIEW), copy.GetPivot().Position);

		if (fall >= 1 && !landed) {
			landed = true;
			// Only the look: no pressure, nothing broken.
			const burst = new Instance("Explosion");
			burst.BlastPressure = 0;
			burst.BlastRadius = 0;
			burst.DestroyJointRadiusPercent = 0;
			burst.Position = pad!.Position;
			burst.Parent = Workspace;
			copy.PrimaryPart?.ClearAllChildren();
		}
	});
	return () => restore?.();
}

/**
 * Plays one stage of the team's travel on this client's camera: the launch, a
 * held shot while the next planet generates (the overlay covers it), or the
 * landing. Returns a function that ends the stage and flies the camera back to
 * the character; the next stage, if any, takes it over again straight away.
 * Each stage lasts as long as the server's (`LAUNCH_SECONDS`, `LAND_SECONDS`).
 */
export function playTravel(travel: Travel): () => void {
	let restore: (() => void) | undefined;
	if (travel.stage === "launch") restore = launch();
	else if (travel.stage === "land") restore = land();
	else drive(() => {});
	return () => {
		restore?.();
		followCharacter();
	};
}
