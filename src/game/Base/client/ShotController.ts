import { Controller, OnStart } from "@flamework/core";
import { Debris, RunService, TweenService, Workspace } from "@rbxts/services";

import { type Shot, ShotMessage, shotMessaging } from "game/Base/shared/base-network";

/** Roblox's own particle textures, so nothing has to be uploaded. */
const SMOKE = "rbxasset://textures/particles/smoke_main.dds";
const FIRE = "rbxasset://textures/particles/fire_main.dds";
const SPARKLE = "rbxasset://textures/particles/sparkles_main.dds";
const FIREBALL = "rbxasset://textures/particles/explosion01_core_main.dds";
const SHOCKWAVE = "rbxasset://textures/particles/explosion01_shockwave_main.dds";
const CHUNK = "rbxasset://textures/particles/SquareParticle.png";

const HOT = Color3.fromRGB(255, 225, 130);
const FLAME = Color3.fromRGB(255, 130, 40);
const EMBER = Color3.fromRGB(140, 40, 20);
const ASH = Color3.fromRGB(70, 68, 66);
const VAPOUR = Color3.fromRGB(210, 210, 215);
const DIRT = Color3.fromRGB(96, 80, 62);
const ROCKET = Color3.fromRGB(255, 150, 60);
const SHELL = Color3.fromRGB(255, 220, 120);
const TRACER = Color3.fromRGB(255, 200, 90);
/** The splash a blast is drawn at its usual size for. Bigger and smaller ones scale with it. */
const BLAST_SPLASH = 8;
/** Seconds a landed shot's smoke trail is left to clear. */
const TRAIL_SECONDS = 1.3;
/** Seconds a blast's slowest particles, its smoke, last. */
const BLAST_SECONDS = 2.6;

/** A rocket or shell as drawn, until it lands. */
interface Flight {
	readonly shot: Shot;
	readonly part: Part;
	readonly fired: number;
	/** Where it lands: its target's position, while that's still there. */
	to: Vector3;
}

/** The point `t` of the way along a quadratic Bézier curve. */
function bezier(from: Vector3, control: Vector3, to: Vector3, t: number): Vector3 {
	return from.Lerp(control, t).Lerp(control.Lerp(to, t), t);
}

/** A NumberSequence through (time, value) points. */
function curve(...points: Array<[time: number, value: number]>): NumberSequence {
	return new NumberSequence(points.map(([time, value]) => new NumberSequenceKeypoint(time, value)));
}

/** A ParticleEmitter in `parent` with these properties. It's off unless they turn it on: `Emit` bursts it. */
function emitter(parent: Instance, props: Partial<WritableInstanceProperties<ParticleEmitter>>): ParticleEmitter {
	const made = new Instance("ParticleEmitter");
	made.Enabled = false;
	for (const [key, value] of pairs(props)) made[key] = value as never;
	made.Parent = parent;
	return made;
}

function attachment(parent: Instance, position: Vector3): Attachment {
	const made = new Instance("Attachment");
	made.Parent = parent;
	made.Position = position;
	return made;
}

/**
 * Draws turret shots; the server deals their damage, so this is only the look. Rockets and shells
 * fly their curve (see `Shot`) for as long as the server says, chasing their target if they have
 * one, trailing flame and smoke, then blow up. Hitscan shots are a fading streak, a flash out of
 * the barrel and sparks off what they hit; the Cannon's also blasts.
 */
@Controller()
export class ShotController implements OnStart {
	private readonly folder = new Instance("Folder");
	private flights = new Array<Flight>();
	/** Shared by every shot: moved to each muzzle and impact in turn, then burst there. */
	private readonly muzzle = new Instance("Attachment");
	private readonly impact = new Instance("Attachment");
	private readonly muzzleFire = emitter(this.muzzle, {
		Texture: FIRE,
		Color: new ColorSequence(HOT, FLAME),
		LightEmission: 1,
		Size: curve([0, 1.4], [1, 0]),
		Transparency: curve([0, 0], [1, 1]),
		Lifetime: new NumberRange(0.06, 0.12),
		Speed: new NumberRange(10, 18),
		SpreadAngle: new Vector2(12, 12),
		EmissionDirection: Enum.NormalId.Front,
	});
	private readonly muzzleSmoke = emitter(this.muzzle, {
		Texture: SMOKE,
		Color: new ColorSequence(VAPOUR),
		Size: curve([0, 1], [1, 3.5]),
		Transparency: curve([0, 0.5], [1, 1]),
		Lifetime: new NumberRange(0.5, 0.9),
		Speed: new NumberRange(3, 6),
		Drag: 3,
		SpreadAngle: new Vector2(25, 25),
		Rotation: new NumberRange(0, 360),
		RotSpeed: new NumberRange(-60, 60),
		EmissionDirection: Enum.NormalId.Front,
	});
	private readonly impactSparks = emitter(this.impact, {
		Texture: SPARKLE,
		Color: new ColorSequence(HOT),
		LightEmission: 1,
		Size: curve([0, 0.45], [1, 0]),
		Lifetime: new NumberRange(0.2, 0.45),
		Speed: new NumberRange(14, 28),
		Acceleration: new Vector3(0, -50, 0),
		SpreadAngle: new Vector2(55, 55),
		EmissionDirection: Enum.NormalId.Front,
	});

	onStart() {
		this.folder.Name = "Shots";
		this.folder.Parent = Workspace;
		// Attachments in the Terrain sit at their own world position.
		this.muzzle.Parent = Workspace.Terrain;
		this.impact.Parent = Workspace.Terrain;
		shotMessaging.client.on(ShotMessage.Fired, (shot) => this.launch(shot));
		shotMessaging.client.on(ShotMessage.Hit, ({ from, to, size }) => this.hit(from, to, size));
		RunService.RenderStepped.Connect(() => this.render());
	}

	/** A rocket or shell leaving its barrel, its tail a glowing streak, a flame (rockets) and smoke left hanging in the air. */
	private launch(shot: Shot) {
		const rocket = shot.kind === "rocket";
		const size = rocket ? new Vector3(0.4, 0.4, 1.4) : new Vector3(1.3, 1.3, 1.3);
		const part = this.spark(size, rocket ? ROCKET : SHELL, shot.from);
		if (!rocket) part.Shape = Enum.PartType.Ball;
		const back = size.Z / 2;
		const width = rocket ? 0.25 : 0.55;
		const trail = new Instance("Trail");
		trail.Attachment0 = attachment(part, new Vector3(0, width, back));
		trail.Attachment1 = attachment(part, new Vector3(0, -width, back));
		trail.Color = new ColorSequence(HOT, FLAME);
		trail.Transparency = curve([0, 0], [1, 1]);
		trail.WidthScale = curve([0, 1], [1, 0.2]);
		trail.Lifetime = rocket ? 0.18 : 0.3;
		trail.LightEmission = 1;
		trail.FaceCamera = true;
		trail.Parent = part;
		const tail = attachment(part, new Vector3(0, 0, back));
		emitter(tail, {
			Texture: SMOKE,
			Color: new ColorSequence(rocket ? VAPOUR : ASH),
			Size: rocket ? curve([0, 0.5], [1, 2.2]) : curve([0, 0.9], [1, 3.2]),
			Transparency: curve([0, rocket ? 0.35 : 0.5], [1, 1]),
			Lifetime: new NumberRange(0.7, 1.2),
			Speed: new NumberRange(0.5, 1.5),
			SpreadAngle: new Vector2(20, 20),
			Rotation: new NumberRange(0, 360),
			RotSpeed: new NumberRange(-60, 60),
			EmissionDirection: Enum.NormalId.Back,
			Rate: rocket ? 60 : 35,
			Enabled: true,
		});
		if (rocket) {
			emitter(tail, {
				Texture: FIRE,
				Color: new ColorSequence(HOT, FLAME),
				LightEmission: 1,
				Size: curve([0, 0.9], [1, 0.1]),
				Transparency: curve([0, 0.1], [1, 1]),
				Lifetime: new NumberRange(0.08, 0.16),
				Speed: new NumberRange(8, 14),
				EmissionDirection: Enum.NormalId.Back,
				Rate: 80,
				Enabled: true,
			});
		}
		this.muzzle.WorldCFrame = CFrame.lookAt(shot.from, shot.control);
		this.muzzleFire.Emit(rocket ? 3 : 8);
		this.muzzleSmoke.Emit(rocket ? 2 : 6);
		this.flights.push({ shot, part, fired: os.clock(), to: shot.to });
	}

	/** A hitscan shot: a streak that fades, a flash out of the barrel, sparks back off what it hit. The Cannon's (`size` 2) also blasts. */
	private hit(from: Vector3, to: Vector3, size: number) {
		const length = to.sub(from).Magnitude;
		if (length < 0.1) return;
		const width = 0.18 * size;
		const streak = this.spark(new Vector3(width, width, length), TRACER, from);
		streak.CFrame = CFrame.lookAt(from, to).mul(new CFrame(0, 0, -length / 2));
		const fade = 0.1 * size;
		TweenService.Create(streak, new TweenInfo(fade), {
			Transparency: 1,
			Size: new Vector3(width / 4, width / 4, length),
		}).Play();
		Debris.AddItem(streak, fade);

		this.muzzle.WorldCFrame = CFrame.lookAt(from, to);
		this.muzzleFire.Emit(2 * size);
		this.impact.WorldCFrame = CFrame.lookAt(to, from);
		this.impactSparks.Emit(5 * size);
		if (size > 1) {
			this.muzzleSmoke.Emit(4);
			this.blast(to, 2 * size, false);
		}
	}

	private render() {
		const now = os.clock();
		this.flights = this.flights.filter((flight) => {
			const { shot, part } = flight;
			if (shot.target?.Parent) flight.to = shot.target.GetPivot().Position;
			const t = (now - flight.fired) / shot.seconds;
			if (t >= 1) {
				// Its smoke stays hanging a while after it's gone.
				part.Transparency = 1;
				for (const child of part.GetDescendants()) if (child.IsA("ParticleEmitter")) child.Enabled = false;
				Debris.AddItem(part, TRAIL_SECONDS);
				this.blast(flight.to, shot.splash, shot.kind === "shell");
				return false;
			}
			const at = bezier(shot.from, shot.control, flight.to, t);
			const ahead = bezier(shot.from, shot.control, flight.to, math.min(t + 0.02, 1));
			part.CFrame = ahead.sub(at).Magnitude > 1e-3 ? CFrame.lookAt(at, ahead) : new CFrame(at);
			return true;
		});
	}

	/**
	 * A blast `splash` studs round: a flash and its light, a fireball, sparks, rolling smoke and a
	 * shockwave along the ground. A `heavy` one (a shell) also throws up dirt and more smoke.
	 */
	private blast(at: Vector3, splash: number, heavy: boolean) {
		const scale = math.max(splash, 1) / BLAST_SPLASH;
		const anchor = new Instance("Attachment");
		anchor.Parent = Workspace.Terrain;
		anchor.Position = at;
		Debris.AddItem(anchor, BLAST_SECONDS);

		const flash = this.spark(Vector3.one, HOT, at);
		flash.Shape = Enum.PartType.Ball;
		flash.Transparency = 0.1;
		TweenService.Create(flash, new TweenInfo(0.2), { Size: Vector3.one.mul(splash * 1.3), Transparency: 1 }).Play();
		Debris.AddItem(flash, 0.2);
		const light = new Instance("PointLight");
		light.Color = FLAME;
		light.Range = math.min(splash * 3, 60);
		light.Brightness = 5;
		light.Parent = anchor;
		TweenService.Create(light, new TweenInfo(0.45), { Brightness: 0 }).Play();

		emitter(anchor, {
			Texture: FIREBALL,
			Color: new ColorSequence([
				new ColorSequenceKeypoint(0, HOT),
				new ColorSequenceKeypoint(0.4, FLAME),
				new ColorSequenceKeypoint(1, EMBER),
			]),
			LightEmission: 1,
			Size: curve([0, 2 * scale], [1, 5 * scale]),
			Transparency: curve([0, 0], [0.6, 0.4], [1, 1]),
			Lifetime: new NumberRange(0.25, 0.5),
			Speed: new NumberRange(6 * scale, 14 * scale),
			Drag: 5,
			SpreadAngle: new Vector2(180, 180),
			Rotation: new NumberRange(0, 360),
			RotSpeed: new NumberRange(-120, 120),
		}).Emit(heavy ? 16 : 12);
		emitter(anchor, {
			Texture: SPARKLE,
			Color: new ColorSequence(HOT),
			LightEmission: 1,
			Size: curve([0, 0.6], [1, 0]),
			Lifetime: new NumberRange(0.4, 0.9),
			Speed: new NumberRange(30 * scale, 60 * scale),
			Acceleration: new Vector3(0, -70, 0),
			Drag: 1.5,
			SpreadAngle: new Vector2(180, 180),
		}).Emit(math.ceil(20 * scale));
		emitter(anchor, {
			Texture: SMOKE,
			Color: new ColorSequence(ASH),
			Size: curve([0, 2 * scale], [1, 7 * scale]),
			Transparency: curve([0, 0.3], [1, 1]),
			Lifetime: new NumberRange(1.2, 2.4),
			Speed: new NumberRange(3 * scale, 8 * scale),
			Acceleration: new Vector3(0, heavy ? 8 : 4, 0),
			Drag: 2,
			SpreadAngle: new Vector2(180, 180),
			Rotation: new NumberRange(0, 360),
			RotSpeed: new NumberRange(-40, 40),
		}).Emit(heavy ? 14 : 8);
		// A ring lying flat: square to its (upward) velocity.
		emitter(anchor, {
			Texture: SHOCKWAVE,
			Color: new ColorSequence(HOT, FLAME),
			LightEmission: 1,
			Orientation: Enum.ParticleOrientation.VelocityPerpendicular,
			EmissionDirection: Enum.NormalId.Top,
			Size: curve([0, 0.5], [1, math.min(splash * 2.2, 100)]),
			Transparency: curve([0, 0.1], [1, 1]),
			Lifetime: new NumberRange(0.4),
			Speed: new NumberRange(0.01),
		}).Emit(1);
		if (heavy) {
			emitter(anchor, {
				Texture: CHUNK,
				Color: new ColorSequence(DIRT),
				Size: curve([0, 0.7], [1, 0.4]),
				Lifetime: new NumberRange(0.8, 1.4),
				Speed: new NumberRange(35, 60),
				Acceleration: new Vector3(0, -90, 0),
				SpreadAngle: new Vector2(35, 35),
				EmissionDirection: Enum.NormalId.Top,
				Rotation: new NumberRange(0, 360),
				RotSpeed: new NumberRange(-300, 300),
			}).Emit(16);
		}
	}

	/** A local neon part that nothing touches. */
	private spark(size: Vector3, color: Color3, at: Vector3): Part {
		const part = new Instance("Part");
		part.Anchored = true;
		part.CanCollide = false;
		part.CanQuery = false;
		part.CanTouch = false;
		part.CastShadow = false;
		part.Material = Enum.Material.Neon;
		part.Color = color;
		part.Size = size;
		part.CFrame = new CFrame(at);
		part.Parent = this.folder;
		return part;
	}
}
