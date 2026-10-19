import { Controller, OnStart } from "@flamework/core";
import { RunService, TweenService, Workspace } from "@rbxts/services";

import { type Shot, ShotMessage, shotMessaging } from "game/Base/shared/base-network";
import {
	aimFrame,
	BEAM_TURN,
	BUILDINGS,
	type BuildingKind,
	shotSpeed,
	turnHead,
	turretAim,
} from "game/Base/shared/buildings";

/** Seconds a barrel takes to slam back when it fires, and to ease back out: a railgun's slower. */
const KICK_SECONDS = 0.04;
const RETURN_SECONDS = 0.25;
const RAIL_RETURN_SECONDS = 0.7;
/** What a railgun's lit rails flare to when it fires, fading back over this many seconds. */
const FLARE = Color3.fromRGB(255, 255, 255);
const FLARE_SECONDS = 0.6;

/** A piece of a barrel, on its `Recoil` weld (see `models`), and when it last fired. */
interface Barrel {
	readonly joint: Weld;
	readonly rest: CFrame;
	readonly kick: Vector3;
	readonly index: number;
	fired?: number;
}

/** A turret's head as this client turns it. */
interface Swivel {
	aim: [yaw: number, pitch: number];
	/** What it last tracked, where that was last frame, and how fast it goes, smoothed, to lead it. */
	target?: Model;
	last?: Vector3;
	velocity: Vector3;
	/** Its barrels' pieces, found the first time it fires. */
	barrels?: ReadonlyArray<Barrel>;
}

/**
 * Turns every turret's head after the alien it tracks (its `Target`, see `WaveService`), each
 * client for itself: no faster than its `turn`, leading the target as the server does, so its guns
 * point where its shots go. With nothing to track, it holds where it points. The server never moves
 * the heads. Each barrel kicks back as it fires and eases back out; a railgun's lit rails flare.
 */
@Controller()
export class TurretController implements OnStart {
	private readonly swivels = new Map<Model, Swivel>();

	onStart() {
		task.spawn(() => {
			const buildings = Workspace.WaitForChild("Base").WaitForChild("Buildings");
			const watch = (child: Instance) => {
				const kind = child.GetAttribute("Kind") as BuildingKind | undefined;
				if (!child.IsA("Model") || kind === undefined || !BUILDINGS[kind].turret) return;
				const rotation = (child.GetAttribute("Rotation") as number | undefined) ?? 0;
				this.swivels.set(child, { aim: [(rotation * math.pi) / 2, 0], velocity: Vector3.zero });
			};
			for (const child of buildings.GetChildren()) watch(child);
			buildings.ChildAdded.Connect(watch);
			buildings.ChildRemoved.Connect((child) => this.swivels.delete(child as Model));
			shotMessaging.client.on(ShotMessage.Fired, (shot) => this.kick(shot));
			RunService.RenderStepped.Connect((dt) => this.render(dt));
		});
	}

	/** Kicks back the barrel a turret's `shot` came out of, flaring a railgun's rails. */
	private kick({ turret, barrel }: Shot) {
		const swivel = turret && this.swivels.get(turret);
		if (!swivel || barrel === undefined) return;
		if (!swivel.barrels || swivel.barrels.isEmpty()) {
			const barrels = new Array<Barrel>();
			for (const joint of turret.GetDescendants()) {
				if (!joint.IsA("Weld") || joint.Name !== "Recoil") continue;
				const index = joint.GetAttribute("Barrel") as number;
				barrels.push({ joint, rest: joint.C0, kick: joint.GetAttribute("Kick") as Vector3, index });
			}
			swivel.barrels = barrels;
		}
		const rail = BUILDINGS[turret.GetAttribute("Kind") as BuildingKind].turret?.rail;
		for (const each of swivel.barrels) {
			if (each.index !== barrel) continue;
			each.fired = os.clock();
			const part = each.joint.Part1;
			if (!rail || !part || part.Material !== Enum.Material.Neon) continue;
			// Its own colour, kept from before it ever flared.
			const color = (part.GetAttribute("Lit") as Color3 | undefined) ?? part.Color;
			part.SetAttribute("Lit", color);
			part.Color = FLARE;
			TweenService.Create(part, new TweenInfo(FLARE_SECONDS), { Color: color }).Play();
		}
	}

	/** Slides each barrel that's fired back, then out again: slammed back at once, eased out. */
	private recoil(barrels: ReadonlyArray<Barrel>, rail: boolean | undefined) {
		const now = os.clock();
		const settle = rail ? RAIL_RETURN_SECONDS : RETURN_SECONDS;
		for (const barrel of barrels) {
			if (barrel.fired === undefined) continue;
			const t = now - barrel.fired;
			const back = t < KICK_SECONDS ? t / KICK_SECONDS : math.max(1 - (t - KICK_SECONDS) / settle, 0) ** 2;
			if (back <= 0) barrel.fired = undefined;
			barrel.joint.C0 = new CFrame(barrel.kick.mul(back)).mul(barrel.rest);
		}
	}

	// ponytail: turns every turret every frame, near or far; cull by camera distance like `AlienController` if bases get huge.
	private render(dt: number) {
		for (const [model, swivel] of this.swivels) {
			const gun = BUILDINGS[model.GetAttribute("Kind") as BuildingKind].turret!;
			if (swivel.barrels) this.recoil(swivel.barrels, gun.rail);
			const head = model.FindFirstChild("Head") as BasePart | undefined;
			const target = (model.FindFirstChild("Target") as ObjectValue | undefined)?.Value as Model | undefined;
			const at = target?.PrimaryPart?.Position;
			if (!head || !at) {
				swivel.target = undefined;
				continue;
			}
			if (target === swivel.target && swivel.last) {
				const moved = at.sub(swivel.last).div(math.max(dt, 1e-3));
				swivel.velocity = swivel.velocity.Lerp(moved, math.min(dt * 10, 1));
			} else {
				swivel.velocity = Vector3.zero;
			}
			swivel.target = target;
			swivel.last = at;

			const from = head.Position;
			const speed = shotSpeed(gun);
			const lead = speed !== undefined ? at.add(swivel.velocity.mul(at.sub(from).Magnitude / speed)) : at;
			// A beam laser turns slower while it burns (see `TurretDef.beam`).
			const turn = model.GetAttribute("Burning") === true ? BEAM_TURN : 1;
			swivel.aim = turnHead(gun, swivel.aim, turretAim(gun, from, lead), dt * turn);
			head.CFrame = aimFrame(from, swivel.aim);
		}
	}
}
