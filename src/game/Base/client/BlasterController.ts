import { Controller, OnStart } from "@flamework/core";
import { Players, TweenService, UserInputService, Workspace } from "@rbxts/services";

import { baseStateAtom, pickedBlasterAtom } from "game/Base/client/base-state";
import { ShotController } from "game/Base/client/ShotController";
import { BaseMessage, baseMessaging } from "game/Base/shared/base-network";
import {
	blasterOf,
	BLASTERS,
	blasterShot,
	type BlasterKind,
	castBlaster,
	isBlaster,
	volleyOf,
} from "game/Base/shared/blasters";
import { ARC_JUMP } from "game/Base/shared/buildings";

/** Added to the server's cooldown between shots, so ordinary jitter doesn't drop shots. */
const FIRE_SLACK = 0.02;
/** How far the Blaster aims, in studs. Past anything, it aims at the end of this. */
const AIM_RANGE = 300;

/** How far the gun jerks back in the hand on a shot, in studs, and how far it tips up, in degrees. */
const KICK_BACK = 0.25;
const KICK_TIP = 6;
/** The longest a kick takes to settle, in seconds. It settles in under the cooldown, so each shot kicks from rest. */
const KICK_SECONDS = 0.12;

/** Where the mouse points: the first thing under it that isn't the character, or `AIM_RANGE` along its ray. */
function aim(character: Model) {
	const camera = Workspace.CurrentCamera;
	if (!camera) return undefined;
	const mouse = UserInputService.GetMouseLocation();
	const ray = camera.ViewportPointToRay(mouse.X, mouse.Y);

	const params = new RaycastParams();
	params.FilterType = Enum.RaycastFilterType.Exclude;
	params.FilterDescendantsInstances = [character];
	const reach = ray.Direction.mul(AIM_RANGE);
	return Workspace.Raycast(ray.Origin, reach, params)?.Position ?? ray.Origin.add(reach);
}

function aliensFolder() {
	return Workspace.FindFirstChild("Base")?.FindFirstChild("Aliens");
}

/**
 * The lightning an Arc Caster's shot ending at `to` draws, as the server strikes it (see
 * `WaveService.zapNear`): from `origin` to the living alien nearest `to`, then on `chain` times to the
 * nearest after each. Straight to `to`, fizzling, with none there.
 */
function lightning(origin: Vector3, to: Vector3, chain: number): Array<Vector3> {
	const aliens = (aliensFolder()?.GetChildren() ?? []).filter(
		(alien): alien is Model => alien.IsA("Model") && ((alien.GetAttribute("Health") as number) ?? 1) > 0,
	);
	const points = [origin];
	const struck = new Set<Model>();
	let at = to;
	while (struck.size() <= chain) {
		let best = ARC_JUMP;
		let nearest: Model | undefined;
		for (const alien of aliens) {
			const distance = alien.GetPivot().Position.sub(at).Magnitude;
			if (distance >= best || struck.has(alien)) continue;
			best = distance;
			nearest = alien;
		}
		if (!nearest) break;
		struck.add(nearest);
		at = nearest.GetPivot().Position;
		points.push(at);
	}
	if (struck.isEmpty()) points.push(to);
	return points;
}

/**
 * Fires the server's Blaster: while the character has one out and the button is held, once per its
 * cooldown, draws the shot from its muzzle at once, cast as the server will cast it, and tells the
 * server where from and at. The server decides what it hits. Keeps `pickedBlasterAtom` up to date.
 */
@Controller()
export class BlasterController implements OnStart {
	private readonly hooked = new Set<Tool>();

	constructor(private readonly shotController: ShotController) {}

	onStart() {
		const player = Players.LocalPlayer;
		pickedBlasterAtom(player.GetAttribute("Blaster"));
		player.GetAttributeChangedSignal("Blaster").Connect(() => pickedBlasterAtom(player.GetAttribute("Blaster")));
		// A tool is parented to the character while it's out, so this sees the Blaster every time it's drawn.
		const watch = (character: Model) => {
			const check = (child: Instance) => {
				if (child.IsA("Tool") && isBlaster(child)) this.hook(child, character);
			};
			character.GetChildren().forEach(check);
			character.ChildAdded.Connect(check);
		};

		if (player.Character) watch(player.Character);
		player.CharacterAdded.Connect(watch);
	}

	private hook(tool: Tool, character: Model) {
		if (this.hooked.has(tool)) return;
		this.hooked.add(tool);
		tool.Destroying.Connect(() => this.hooked.delete(tool));

		const rest = tool.Grip;
		let settle: Tween | undefined;
		/** Jerks the gun back and lets it ease home before the next shot. */
		const kick = (seconds: number) => {
			settle?.Cancel();
			tool.Grip = rest.mul(new CFrame(0, 0, -KICK_BACK)).mul(CFrame.Angles(math.rad(KICK_TIP), 0, 0));
			settle = TweenService.Create(tool, new TweenInfo(math.min(seconds, KICK_SECONDS), Enum.EasingStyle.Quad), {
				Grip: rest,
			});
			settle.Play();
		};

		let held = false;
		let firing = false;
		const release = () => {
			held = false;
		};
		tool.Unequipped.Connect(() => {
			settle?.Cancel();
			tool.Grip = rest;
		});
		tool.Deactivated.Connect(release);
		tool.Unequipped.Connect(release);
		tool.Activated.Connect(() => {
			held = true;
			// One loop at a time, so clicking faster than it fires can't fire faster.
			if (firing) return;
			firing = true;
			task.spawn(() => {
				while (held && tool.Parent === character) {
					const kind = blasterOf(tool.GetAttribute("Blaster"), baseStateAtom()?.core ?? "core");
					const cooldown = BLASTERS[kind].seconds;
					if (this.fire(tool, character, kind)) kick(cooldown * 0.8);
					task.wait(cooldown + FIRE_SLACK);
				}
				firing = false;
			});
		});
	}

	/** Fires `tool` once at the mouse: draws the shot and tells the server. False if it couldn't aim. */
	private fire(tool: Tool, character: Model, kind: BlasterKind): boolean {
		const target = aim(character);
		const handle = tool.FindFirstChild("Handle");
		if (!target || !handle?.IsA("BasePart")) return false;
		const muzzle = handle.FindFirstChild("Muzzle");
		const origin = muzzle?.IsA("Attachment") ? muzzle.WorldPosition : handle.Position;
		const offset = target.sub(origin);
		if (offset.Magnitude < 0.01) return false;

		baseMessaging.server.emit(BaseMessage.Fire, { origin, target });
		const gun = BLASTERS[kind];
		for (const along of volleyOf(gun, offset.Unit)) {
			const [to] = castBlaster(gun, origin, along, [character], aliensFolder());
			if (gun.projectile === "arc") this.shotController.arc(lightning(origin, to, gun.chain ?? 0));
			// Negative, like every Blaster shot: only turret shots (0 up) are shot down (see `ShotMessage.Downed`).
			else this.shotController.launch(blasterShot(kind, -1, origin, to));
		}
		return true;
	}
}
