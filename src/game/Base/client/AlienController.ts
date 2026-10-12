import { Controller, OnStart } from "@flamework/core";
import { RunService, Workspace } from "@rbxts/services";

import { pingedAtom } from "game/Base/client/base-state";
import { ALIEN_GAITS, type Gait, type Leg } from "game/Base/shared/alien-legs";
import type { AlienKind } from "game/Base/shared/base-network";

/** The hulls' dark metal and plating (see the server's models), and the dust a heavy footfall throws up. */
const BONE = Color3.fromRGB(46, 48, 56);
const JOINT = Color3.fromRGB(104, 108, 120);
const DUST = Color3.fromRGB(150, 130, 105);
/** Radians a second a turret turns, and how far it tips its guns down (fliers' look straight under them) and up. */
const TURRET_TURN = 6;
const LOWEST = math.rad(-85);
const HIGHEST = math.rad(70);
/**
 * Culling, by distance from the camera. Beyond `HIDE_STUDS` an alien isn't drawn at all, unless a
 * ping shows it. Beyond `THROTTLE_STUDS` its legs and turrets move every `THROTTLE_FRAMES` frames.
 * Off screen, by more than `SCREEN_MARGIN` of its width, they stand still, unless within `NEAR_STUDS`.
 */
const HIDE_STUDS = 250;
const THROTTLE_STUDS = 120;
const THROTTLE_FRAMES = 3;
const SCREEN_MARGIN = 0.2;
const NEAR_STUDS = 30;
/**
 * Slower than this, in studs per second, a walker is standing, and its feet settle back under it
 * once this share of a stride out.
 */
const MOVING = 0.5;
const SETTLE = 0.3;
/** The quickest a step can be however fast the walker goes, and the share of a stride's time a step takes. */
const QUICKEST_STEP = 0.08;
const STEP_SHARE = 0.7;
/** How far above the hull, and below, to look for the ground under a foot. */
const GROUND_ABOVE = 10;
const GROUND_BELOW = 60;
/** Legs at least this thick get a ball at the hip and the knee. */
const JOINTED = 0.5;

/** One leg as it walks. */
interface Stance {
	readonly leg: Leg;
	readonly thigh: Part;
	readonly shin: Part;
	readonly pad?: Part;
	readonly hipBall?: Part;
	readonly kneeBall?: Part;
	/** Where the foot is down, or coming down while `t` (0 to 1) is under 1, stepping from `from`. */
	planted: Vector3;
	from: Vector3;
	t: number;
}

interface Swivel {
	readonly motor: Motor6D;
	/** The model's attribute saying what it aims at. */
	readonly attribute: string;
	yaw: number;
	pitch: number;
}

interface Rig {
	readonly root: BasePart;
	readonly gait?: Gait;
	readonly stances: ReadonlyArray<Stance>;
	readonly swivels: ReadonlyArray<Swivel>;
	/** Where the hull was last frame, and how fast it goes across the ground, smoothed. */
	last: Vector3;
	velocity: Vector3;
	/** Whether it's hidden (see `HIDE_STUDS`), seconds since its legs last moved, and its turn among throttled frames. */
	hidden: boolean;
	idle: number;
	readonly slot: number;
}

/** A bone from `from` to `to`, its sides squared to `up`. */
function bone(from: Vector3, to: Vector3, up: Vector3): CFrame {
	return CFrame.lookAt(from.Lerp(to, 0.5), to, up);
}

/** Whether `point` is in front of the camera and on screen, or off its edge by no more than `SCREEN_MARGIN`. */
function onScreen(camera: Camera, point: Vector3): boolean {
	const [at] = camera.WorldToViewportPoint(point);
	const size = camera.ViewportSize;
	const margin = size.X * SCREEN_MARGIN;
	return at.Z > 0 && at.X > -margin && at.X < size.X + margin && at.Y > -margin && at.Y < size.Y + margin;
}

function flatDistance(a: Vector3, b: Vector3): number {
	return math.sqrt((a.X - b.X) ** 2 + (a.Z - b.Z) ** 2);
}

/**
 * Brings the aliens' machinery to life, each client for itself, as the server only moves their hulls.
 * Turrets turn after what they aim at (`Aim<i>`, see `WaveService`). Walkers walk on legs (see
 * `ALIEN_GAITS`), each a thigh and shin bent at the knee to reach a foot planted on the ground: a
 * foot stays put until the hull leaves it a stride behind, then steps on ahead in an arc, one group
 * of legs at a time.
 */
@Controller()
export class AlienController implements OnStart {
	private readonly rigs = new Map<Model, Rig>();
	/** Aliens seen but not yet rigged, waiting on their hull. */
	private readonly unrigged = new Set<Model>();
	private readonly ground = new RaycastParams();
	private readonly dust = new Instance("Attachment");
	private readonly dustCloud = new Instance("ParticleEmitter");
	private frame = 0;

	onStart() {
		this.ground.FilterType = Enum.RaycastFilterType.Include;
		this.ground.FilterDescendantsInstances = [Workspace.Terrain];
		// Attachments in the Terrain sit at their own world position.
		this.dust.Parent = Workspace.Terrain;
		const cloud = this.dustCloud;
		cloud.Enabled = false;
		cloud.Texture = "rbxasset://textures/particles/smoke_main.dds";
		cloud.Color = new ColorSequence(DUST);
		cloud.Size = new NumberSequence(1.5, 5);
		cloud.Transparency = new NumberSequence(0.35, 1);
		cloud.Lifetime = new NumberRange(0.8, 1.4);
		cloud.Speed = new NumberRange(4, 9);
		cloud.Drag = 3;
		cloud.SpreadAngle = new Vector2(80, 80);
		cloud.EmissionDirection = Enum.NormalId.Top;
		cloud.Rotation = new NumberRange(0, 360);
		cloud.RotSpeed = new NumberRange(-40, 40);
		cloud.Parent = this.dust;

		task.spawn(() => {
			const aliens = Workspace.WaitForChild("Base").WaitForChild("Aliens");
			for (const child of aliens.GetChildren()) if (child.IsA("Model")) this.unrigged.add(child);
			aliens.ChildAdded.Connect((child) => {
				if (child.IsA("Model")) this.unrigged.add(child);
			});
		});
		RunService.RenderStepped.Connect((dt) => this.render(dt));
	}

	private render(dt: number) {
		for (const model of this.unrigged) {
			const root = model.PrimaryPart;
			if (model.Parent && !root) continue;
			this.unrigged.delete(model);
			if (root) this.rigs.set(model, this.rig(model, root));
		}

		const camera = Workspace.CurrentCamera;
		if (!camera) return;
		const eye = camera.CFrame.Position;
		const pinged = pingedAtom();
		this.frame++;
		const parts = new Array<BasePart>();
		const cframes = new Array<CFrame>();
		for (const [model, rig] of this.rigs) {
			if (!model.Parent) {
				this.rigs.delete(model);
				continue;
			}
			const body = rig.root.CFrame;
			const distance = body.Position.sub(eye).Magnitude;
			this.hide(model, rig, distance > HIDE_STUDS && !pinged);
			rig.idle += dt;
			if (rig.hidden || (distance > NEAR_STUDS && !onScreen(camera, body.Position))) continue;
			if (distance > THROTTLE_STUDS && (this.frame + rig.slot) % THROTTLE_FRAMES !== 0) continue;
			// By the time since they last moved, so throttled legs keep up.
			const elapsed = rig.idle;
			rig.idle = 0;
			for (const swivel of rig.swivels) this.turn(swivel, model, body, elapsed);
			if (rig.gait) this.walk(rig, rig.gait, body, elapsed, parts, cframes);
		}
		Workspace.BulkMoveTo(parts, cframes, Enum.BulkMoveMode.FireCFrameChanged);
	}

	/** Finds an alien's turrets, and builds its legs, each foot down where it rests. */
	private rig(model: Model, root: BasePart): Rig {
		const swivels = new Array<Swivel>();
		for (const child of model.GetChildren()) {
			const [index] = child.Name.match("^Turret(%d+)$");
			const motor = child.FindFirstChild("Mount");
			if (index !== undefined && motor?.IsA("Motor6D")) {
				swivels.push({ motor, attribute: `Aim${index}`, yaw: 0, pitch: 0 });
			}
		}

		const gait = ALIEN_GAITS[model.GetAttribute("Kind") as AlienKind];
		const body = root.CFrame;
		const stances = new Array<Stance>();
		if (gait) {
			const { width, pad } = gait;
			const jointed = width >= JOINTED;
			const ball = () => this.part(model, body, Vector3.one.mul(width * 1.3), JOINT, Enum.PartType.Ball);
			for (const leg of gait.legs) {
				const planted = this.groundAt(body.PointToWorldSpace(leg.rest), body.Position.Y);
				stances.push({
					leg,
					thigh: this.part(model, body, new Vector3(width, width, gait.thigh), BONE),
					shin: this.part(model, body, new Vector3(width * 0.85, width * 0.85, gait.shin), BONE),
					pad: pad && this.part(model, body, pad, JOINT),
					hipBall: jointed ? ball() : undefined,
					kneeBall: jointed ? ball() : undefined,
					planted,
					from: planted,
					t: 1,
				});
			}
		}
		return {
			root,
			gait,
			stances,
			swivels,
			last: body.Position,
			velocity: Vector3.zero,
			hidden: false,
			idle: 0,
			slot: math.random(0, THROTTLE_FRAMES - 1),
		};
	}

	/** Hides an alien, legs and all, or shows it again, when that changes. A hidden part isn't drawn. */
	private hide(model: Model, rig: Rig, hidden: boolean) {
		if (rig.hidden === hidden) return;
		rig.hidden = hidden;
		for (const part of model.GetDescendants()) {
			if (part.IsA("BasePart")) part.LocalTransparencyModifier = hidden ? 1 : 0;
		}
	}

	/** Turns a turret toward what it aims at, or back to rest with nothing, at most `TURRET_TURN` a second. */
	private turn(swivel: Swivel, model: Model, body: CFrame, dt: number) {
		const aim = model.GetAttribute(swivel.attribute) as Vector3 | undefined;
		let yaw = 0;
		let pitch = 0;
		if (aim) {
			// As the turret sees it, resting on the hull.
			const seen = body.mul(swivel.motor.C0).PointToObjectSpace(aim);
			yaw = math.atan2(-seen.X, -seen.Z);
			pitch = math.clamp(math.atan2(seen.Y, math.sqrt(seen.X ** 2 + seen.Z ** 2)), LOWEST, HIGHEST);
		}
		const step = TURRET_TURN * dt;
		// The short way round.
		swivel.yaw += math.clamp(((yaw - swivel.yaw + math.pi) % (2 * math.pi)) - math.pi, -step, step);
		swivel.pitch += math.clamp(pitch - swivel.pitch, -step, step);
		swivel.motor.Transform = CFrame.Angles(0, swivel.yaw, 0).mul(CFrame.Angles(swivel.pitch, 0, 0));
	}

	/**
	 * Walks a walker's legs a frame. A foot left a stride behind where it rests steps (or, standing, a
	 * little out of place, settles): ahead of where it rests by as far as the hull goes during the step
	 * and half a stride on, so it lands with the stride ahead of it. A group only lifts while the other
	 * has its feet down.
	 */
	private walk(rig: Rig, gait: Gait, body: CFrame, dt: number, parts: Array<BasePart>, cframes: Array<CFrame>) {
		const position = body.Position;
		const moved = position.sub(rig.last);
		rig.last = position;
		rig.velocity = rig.velocity.Lerp(
			new Vector3(moved.X, 0, moved.Z).div(math.max(dt, 1e-3)),
			math.min(dt * 10, 1),
		);
		const speed = rig.velocity.Magnitude;
		const moving = speed > MOVING;
		const seconds = math.max(
			math.min(gait.seconds, (STEP_SHARE * gait.stride) / math.max(speed, 1e-3)),
			QUICKEST_STEP,
		);
		const lifted = [false, false];
		for (const stance of rig.stances) if (stance.t < 1) lifted[stance.leg.group] = true;
		const flat = new Vector3(body.LookVector.X, 0, body.LookVector.Z);
		const look = flat.Magnitude > 1e-3 ? flat.Unit : new Vector3(0, 0, -1);

		for (const stance of rig.stances) {
			const { leg } = stance;
			const rest = body.PointToWorldSpace(leg.rest);
			const behind = flatDistance(stance.planted, rest);
			if (stance.t >= 1 && !lifted[1 - leg.group] && behind > gait.stride * (moving ? 1 : SETTLE)) {
				const lead = moving
					? rig.velocity.mul(seconds).add(rig.velocity.Unit.mul(gait.stride / 2))
					: Vector3.zero;
				stance.from = stance.planted;
				stance.planted = this.groundAt(rest.add(lead), position.Y);
				stance.t = 0;
				lifted[leg.group] = true;
			}
			let foot = stance.planted;
			if (stance.t < 1) {
				stance.t = math.min(stance.t + dt / seconds, 1);
				const ease = stance.t * stance.t * (3 - 2 * stance.t);
				const arc = new Vector3(0, gait.lift * math.sin(math.pi * stance.t), 0);
				foot = stance.from.Lerp(stance.planted, ease).add(arc);
				if (stance.t >= 1 && gait.stomp) this.stomp(stance.planted, gait.width);
			}
			this.pose(stance, gait, body, foot, look, parts, cframes);
		}
	}

	/**
	 * Lays a leg's bones from its hip on the hull to `foot`: the knee as far along the line to the ankle
	 * as the bones' lengths put it, and out the way the knee juts. Out of reach, the leg reaches
	 * straight for it.
	 */
	private pose(
		stance: Stance,
		gait: Gait,
		body: CFrame,
		foot: Vector3,
		look: Vector3,
		parts: Array<BasePart>,
		cframes: Array<CFrame>,
	) {
		const { thigh, shin, pad } = gait;
		const hip = body.PointToWorldSpace(stance.leg.hip);
		// The shin ends at the ankle, on top of the pad if it has one.
		const ankle = pad ? foot.add(new Vector3(0, pad.Y, 0)) : foot;
		const reach = ankle.sub(hip);
		const length = math.clamp(reach.Magnitude, math.abs(thigh - shin) + 0.01, thigh + shin - 0.01);
		const down = reach.Magnitude > 1e-3 ? reach.Unit : body.UpVector.mul(-1);
		const tip = hip.add(down.mul(length));
		const along = (thigh * thigh - shin * shin + length * length) / (2 * length);
		const out = math.sqrt(math.max(thigh * thigh - along * along, 0));
		const pole = body.VectorToWorldSpace(stance.leg.knee);
		const square = pole.sub(down.mul(pole.Dot(down)));
		const bend = square.Magnitude > 1e-3 ? square.Unit : body.LookVector;
		const knee = hip.add(down.mul(along)).add(bend.mul(out));

		parts.push(stance.thigh, stance.shin);
		cframes.push(bone(hip, knee, bend), bone(knee, tip, bend));
		if (stance.hipBall && stance.kneeBall) {
			parts.push(stance.hipBall, stance.kneeBall);
			cframes.push(new CFrame(hip), new CFrame(knee));
		}
		if (stance.pad && pad) {
			const center = tip.sub(new Vector3(0, pad.Y / 2, 0));
			parts.push(stance.pad);
			cframes.push(CFrame.lookAt(center, center.add(look)));
		}
	}

	/** Where the ground is under `point`, looking down from above the hull at `top`. Off the map, `point` itself. */
	private groundAt(point: Vector3, top: number): Vector3 {
		const origin = new Vector3(point.X, top + GROUND_ABOVE, point.Z);
		const hit = Workspace.Raycast(origin, new Vector3(0, -GROUND_ABOVE - GROUND_BELOW, 0), this.ground);
		return hit?.Position ?? point;
	}

	/** A heavy footfall's puff of dust, bigger for thicker legs. */
	private stomp(at: Vector3, width: number) {
		this.dust.Position = at;
		this.dustCloud.Emit(math.ceil(width * 4));
	}

	/**
	 * A local part of a leg: nothing touches or hits it, and the server never sees it. It starts tucked
	 * in the hull at `at`, out of sight until it's first posed.
	 */
	private part(model: Model, at: CFrame, size: Vector3, color: Color3, shape?: Enum.PartType): Part {
		const part = new Instance("Part");
		part.CFrame = at;
		part.Anchored = true;
		part.CanCollide = false;
		part.CanQuery = false;
		part.CanTouch = false;
		part.Material = Enum.Material.Metal;
		part.Color = color;
		part.Size = size;
		if (shape) part.Shape = shape;
		part.Parent = model;
		return part;
	}
}
