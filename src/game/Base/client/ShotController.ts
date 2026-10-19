import { Controller, OnStart } from "@flamework/core";
import { Debris, RunService, TweenService, Workspace } from "@rbxts/services";

import { bezier, type Shot, ShotMessage, shotMessaging } from "game/Base/shared/base-network";
import { BLASTERS } from "game/Base/shared/blasters";
import { BUILDINGS, type BuildingKind } from "game/Base/shared/buildings";

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
const ENEMY_TRACER = Color3.fromRGB(255, 70, 60);
const LASER = Color3.fromRGB(255, 90, 70);
const LIGHTNING = Color3.fromRGB(150, 205, 255);
const BRASS = Color3.fromRGB(214, 170, 80);
/** Seconds a muzzle's flash of light lasts. */
const FLASH_SECONDS = 0.1;
/** A laser's ray goes out this many seconds after its last pulse, and is this thick at full charge. */
const RAY_SECONDS = 0.3;
const RAY_WIDTH = 2.2;
const CORE_WIDTH = 0.8;
/** How many jags lightning makes between two aliens, and how far each strays off the straight line, in studs. */
const ARC_KINKS = 4;
const ARC_STRAY = 1.5;

const random = new Random();
/** The splash a blast is drawn at its usual size for. Bigger and smaller ones scale with it. */
const BLAST_SPLASH = 8;
/** Seconds a landed shot's smoke trail is left to clear. */
const TRAIL_SECONDS = 1.3;
/** Seconds a blast's slowest particles, its smoke, last. */
const BLAST_SECONDS = 2.6;

/** A laser turret's ray, held on while its pulses come: from its muzzle, in its head's space, along where the head points. */
interface Ray {
	readonly outer: Part;
	readonly core: Part;
	muzzle: Vector3;
	length: number;
	/** How far out it reaches, 0 to 1: as the server last said, and as drawn, easing after it. */
	reach: number;
	shown: number;
	last: number;
}

/** A shot as drawn, until it lands. */
interface Flight {
	readonly shot: Shot;
	readonly part: Part;
	readonly fired: number;
	/** Where it lands: its target's position, while that's still there. */
	to: Vector3;
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
 * Draws turret and alien shots; the server deals their damage, so this is only the look. Every
 * turret shot flies its curve (see `Shot`) for as long as the server says, chasing its target if it
 * has one. Bullets are glowing tracers that spark where they end, and blast if they splash; flames
 * are fireballs that flare where they end. Rockets and shells trail flame and smoke, then blow up.
 * Flak bursts in a dark puff in the air. Aliens' hitscan shots are a fading red streak, a flash out
 * of the barrel and sparks off what they hit; a heavy one also blasts. A sapper just blasts. A shot
 * that point defence downs pops where it is, struck by a red streak. A laser holds a white-hot
 * ray on while it fires; lightning crackles in jags from alien to alien. A turret's shot lights up its muzzle, a gun
 * flips out a brass casing, and a railgun's slug leaves in rings of shockwave.
 */
@Controller()
export class ShotController implements OnStart {
	private readonly folder = new Instance("Folder");
	private flights = new Array<Flight>();
	private readonly rays = new Map<Model, Ray>();
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
	/** Rings out of a railgun's muzzle, square to its shot. */
	private readonly muzzleRings = emitter(this.muzzle, {
		Texture: SHOCKWAVE,
		Color: new ColorSequence(new Color3(1, 1, 1), LIGHTNING),
		LightEmission: 1,
		Orientation: Enum.ParticleOrientation.VelocityPerpendicular,
		EmissionDirection: Enum.NormalId.Front,
		Size: curve([0, 0.5], [1, 7]),
		Transparency: curve([0, 0], [1, 1]),
		Lifetime: new NumberRange(0.3, 0.45),
		Speed: new NumberRange(2, 14),
	});
	/** Shared by every gun: moved beside each one's breech, looking out and up, then a casing flipped out. */
	private readonly breech = new Instance("Attachment");
	private readonly casings = emitter(this.breech, {
		Texture: CHUNK,
		Color: new ColorSequence(BRASS),
		Size: curve([0, 0.3], [1, 0.3]),
		Lifetime: new NumberRange(0.6, 0.9),
		Speed: new NumberRange(10, 16),
		Acceleration: new Vector3(0, -80, 0),
		SpreadAngle: new Vector2(15, 15),
		EmissionDirection: Enum.NormalId.Front,
		Rotation: new NumberRange(0, 360),
		RotSpeed: new NumberRange(-720, 720),
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
	private readonly impactFire = emitter(this.impact, {
		Texture: FIRE,
		Color: new ColorSequence(HOT, FLAME),
		LightEmission: 1,
		Size: curve([0, 1.5], [1, 3]),
		Transparency: curve([0, 0.2], [1, 1]),
		Lifetime: new NumberRange(0.2, 0.4),
		Speed: new NumberRange(3, 8),
		SpreadAngle: new Vector2(180, 180),
	});

	onStart() {
		this.folder.Name = "Shots";
		this.folder.Parent = Workspace;
		// Attachments in the Terrain sit at their own world position.
		this.muzzle.Parent = Workspace.Terrain;
		this.impact.Parent = Workspace.Terrain;
		this.breech.Parent = Workspace.Terrain;
		shotMessaging.client.on(ShotMessage.Fired, (shot) => this.launch(shot));
		shotMessaging.client.on(ShotMessage.Hit, ({ from, to, size, hostile }) => this.hit(from, to, size, hostile));
		shotMessaging.client.on(ShotMessage.Blast, ({ at, splash }) => this.blast(at, splash, true));
		shotMessaging.client.on(ShotMessage.Downed, ({ id, from }) => this.down(id, from));
		shotMessaging.client.on(ShotMessage.Beam, ({ turret, from, to, reach }) => this.beam(turret, from, to, reach));
		shotMessaging.client.on(ShotMessage.Arc, ({ points }) => this.arc(points));
		RunService.RenderStepped.Connect((dt) => this.render(dt));
	}

	/** A rocket or shell leaving its barrel, its tail a glowing streak, a flame (rockets) and smoke left hanging in the air. */
	launch(shot: Shot) {
		if (shot.turret && shot.kind !== "flame") this.flash(shot, shot.turret);
		if (shot.kind === "flak") return this.launchFlak(shot);
		if (shot.kind === "bullet") return this.launchBullet(shot);
		if (shot.kind === "flame") return this.launchFlame(shot);
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

	/**
	 * A `turret`'s shot leaving it: a flash of light at the muzzle, and a brass casing flipped out of a
	 * gun's breech, on its barrel's side; a railgun's flash is bigger and blue, and rings shock out.
	 */
	private flash(shot: Shot, turret: Model) {
		const rail = BUILDINGS[turret.GetAttribute("Kind") as BuildingKind].turret?.rail;
		const size = shot.size ?? 1;
		const anchor = new Instance("Attachment");
		anchor.Parent = Workspace.Terrain;
		anchor.Position = shot.from;
		Debris.AddItem(anchor, FLASH_SECONDS);
		const light = new Instance("PointLight");
		light.Color = rail ? LIGHTNING : FLAME;
		light.Range = rail ? 10 * size : 6 + 3 * size;
		light.Brightness = rail ? 6 : 3;
		light.Parent = anchor;
		TweenService.Create(light, new TweenInfo(FLASH_SECONDS), { Brightness: 0 }).Play();
		if (rail) {
			this.muzzle.WorldCFrame = CFrame.lookAt(shot.from, shot.to);
			this.muzzleRings.Emit(3);
			return;
		}
		const head = turret.FindFirstChild("Head") as BasePart | undefined;
		if (!head || (shot.kind !== "bullet" && shot.kind !== "flak")) return;
		const side = head.CFrame.PointToObjectSpace(shot.from).X >= 0 ? 1 : -1;
		const out = head.CFrame.RightVector.mul(side);
		const at = head.Position.add(out.mul(head.Size.X / 2)).add(head.CFrame.UpVector.mul(head.Size.Y / 4));
		this.breech.WorldCFrame = CFrame.lookAt(at, at.add(out).add(Vector3.yAxis));
		this.casings.Emit(1);
	}

	/** Flak: a hot pellet with a short streak behind it, and a flash out of the barrel. No smoke until it bursts. */
	private launchFlak(shot: Shot) {
		const part = this.spark(Vector3.one.mul(0.5), HOT, shot.from);
		part.Shape = Enum.PartType.Ball;
		const trail = new Instance("Trail");
		trail.Attachment0 = attachment(part, new Vector3(0, 0.15, 0));
		trail.Attachment1 = attachment(part, new Vector3(0, -0.15, 0));
		trail.Color = new ColorSequence(HOT, FLAME);
		trail.Transparency = curve([0, 0.2], [1, 1]);
		trail.Lifetime = 0.08;
		trail.LightEmission = 1;
		trail.FaceCamera = true;
		trail.Parent = part;
		this.muzzle.WorldCFrame = CFrame.lookAt(shot.from, shot.to);
		this.muzzleFire.Emit(2);
		this.flights.push({ shot, part, fired: os.clock(), to: shot.to });
	}

	/** A bullet: a glowing tracer as heavy as its turret, with a short streak behind it, and a flash (and smoke, from a big gun) out of the barrel. */
	private launchBullet(shot: Shot) {
		const size = shot.size ?? 1;
		const color = shot.blaster ? BLASTERS[shot.blaster].color : TRACER;
		const part = this.spark(new Vector3(0.2, 0.2, 1.2).mul(size), color, shot.from);
		const width = 0.1 * size;
		const trail = new Instance("Trail");
		trail.Attachment0 = attachment(part, new Vector3(0, width, 0));
		trail.Attachment1 = attachment(part, new Vector3(0, -width, 0));
		trail.Color = new ColorSequence(HOT, color);
		trail.Transparency = curve([0, 0.2], [1, 1]);
		trail.Lifetime = shot.blaster ? 0.1 : 0.06;
		trail.LightEmission = 1;
		trail.FaceCamera = true;
		trail.Parent = part;
		this.muzzle.WorldCFrame = CFrame.lookAt(shot.from, shot.to);
		this.muzzleFire.Emit(2 * size);
		if (size > 1) this.muzzleSmoke.Emit(2 * size);
		this.flights.push({ shot, part, fired: os.clock(), to: shot.to });
	}

	/** A flame: a fireball that licks out of the nozzle, shedding fire as it goes. */
	private launchFlame(shot: Shot) {
		const part = this.spark(Vector3.one, FLAME, shot.from);
		part.Shape = Enum.PartType.Ball;
		part.Transparency = 0.4;
		emitter(part, {
			Texture: FIRE,
			Color: new ColorSequence(HOT, FLAME),
			LightEmission: 1,
			Size: curve([0, 1], [1, 2.5]),
			Transparency: curve([0, 0.2], [1, 1]),
			Lifetime: new NumberRange(0.15, 0.3),
			Speed: new NumberRange(1, 3),
			SpreadAngle: new Vector2(180, 180),
			Rate: 40,
			Enabled: true,
		});
		this.flights.push({ shot, part, fired: os.clock(), to: shot.to });
	}

	/** Flak bursting in the air: a quick flash, a few sparks and a ragged puff of dark smoke `splash` studs round. */
	private puff(at: Vector3, splash: number) {
		const anchor = new Instance("Attachment");
		anchor.Parent = Workspace.Terrain;
		anchor.Position = at;
		Debris.AddItem(anchor, BLAST_SECONDS);

		const flash = this.spark(Vector3.one, HOT, at);
		flash.Shape = Enum.PartType.Ball;
		flash.Transparency = 0.2;
		TweenService.Create(flash, new TweenInfo(0.12), { Size: Vector3.one.mul(splash), Transparency: 1 }).Play();
		Debris.AddItem(flash, 0.12);
		emitter(anchor, {
			Texture: SMOKE,
			Color: new ColorSequence(EMBER, ASH),
			Size: curve([0, splash * 0.4], [1, splash * 0.9]),
			Transparency: curve([0, 0.2], [1, 1]),
			Lifetime: new NumberRange(0.8, 1.4),
			Speed: new NumberRange(1, 3),
			Drag: 3,
			SpreadAngle: new Vector2(180, 180),
			Rotation: new NumberRange(0, 360),
			RotSpeed: new NumberRange(-40, 40),
		}).Emit(4);
		emitter(anchor, {
			Texture: SPARKLE,
			Color: new ColorSequence(HOT),
			LightEmission: 1,
			Size: curve([0, 0.4], [1, 0]),
			Lifetime: new NumberRange(0.2, 0.4),
			Speed: new NumberRange(15, 30),
			SpreadAngle: new Vector2(180, 180),
		}).Emit(5);
	}

	/** An alien's hitscan shot: a streak that fades, a flash out of the barrel, sparks back off what it hit. A heavy one (`size` 2 and up) also blasts. */
	private hit(from: Vector3, to: Vector3, size: number, hostile?: boolean) {
		const length = to.sub(from).Magnitude;
		if (length < 0.1) return;
		const width = 0.18 * size;
		const streak = this.spark(new Vector3(width, width, length), hostile ? ENEMY_TRACER : TRACER, from);
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

	/** A laser's pulse: keeps its `turret`'s ray, a red beam round a white-hot core, on (see `render`), flaring where it ends. */
	private beam(turret: Model, from: Vector3, to: Vector3, reach: number) {
		const head = turret.FindFirstChild("Head") as BasePart | undefined;
		if (!head) return;
		const ray = this.rays.get(turret) ?? {
			outer: this.spark(Vector3.one, LASER, from),
			core: this.spark(Vector3.one, HOT, from),
			muzzle: Vector3.zero,
			length: 0,
			reach,
			shown: 0,
			last: 0,
		};
		this.rays.set(turret, ray);
		ray.muzzle = head.CFrame.PointToObjectSpace(from);
		ray.length = to.sub(from).Magnitude;
		ray.reach = reach;
		ray.last = os.clock();
		this.impact.WorldCFrame = CFrame.lookAt(from.Lerp(to, ray.shown), from);
		this.impactFire.Emit(1);
	}

	/** Lightning through `points`, in jags between each and the next, sparking off each alien it strikes. */
	arc(points: ReadonlyArray<Vector3>) {
		for (let i = 1; i < points.size(); i++) {
			const from = points[i - 1];
			const to = points[i];
			let last = from;
			for (let kink = 1; kink <= ARC_KINKS; kink++) {
				const stray = new Vector3(random.NextNumber(-1, 1), random.NextNumber(-1, 1), random.NextNumber(-1, 1));
				const point = kink === ARC_KINKS ? to : from.Lerp(to, kink / ARC_KINKS).add(stray.mul(ARC_STRAY));
				this.bolt(last, point, 0.3, LIGHTNING, 0.12);
				last = point;
			}
			this.impact.WorldCFrame = CFrame.lookAt(to, from);
			this.impactSparks.Emit(3);
		}
	}

	/** A glowing bar from `from` to `to`, `width` thick, thinning away to nothing over `fade` seconds. */
	private bolt(from: Vector3, to: Vector3, width: number, color: Color3, fade: number) {
		const length = to.sub(from).Magnitude;
		if (length < 0.1) return;
		const part = this.spark(new Vector3(width, width, length), color, from);
		part.CFrame = CFrame.lookAt(from, to).mul(new CFrame(0, 0, -length / 2));
		TweenService.Create(part, new TweenInfo(fade), {
			Transparency: 1,
			Size: new Vector3(width / 4, width / 4, length),
		}).Play();
		Debris.AddItem(part, fade);
	}

	/** The shot `id`, shot down by point defence from `from`: struck where it is now, it pops in a puff, short of where it was going. */
	private down(id: number, from: Vector3) {
		const flight = this.flights.find((each) => each.shot.id === id);
		if (!flight) return;
		this.flights.remove(this.flights.indexOf(flight));
		const at = flight.part.Position;
		this.hit(from, at, 1, true);
		this.puff(at, 3);
		this.vanish(flight.part);
	}

	/** Hides a landed or downed shot. Its smoke stays hanging a while after it's gone. */
	private vanish(part: Part) {
		part.Transparency = 1;
		for (const child of part.GetDescendants()) if (child.IsA("ParticleEmitter")) child.Enabled = false;
		Debris.AddItem(part, TRAIL_SECONDS);
	}

	private render(dt: number) {
		const now = os.clock();
		// Each ray out of its muzzle where its head points now, reaching out and drawing back in, its width throbbing.
		for (const [turret, ray] of this.rays) {
			const head = turret.FindFirstChild("Head") as BasePart | undefined;
			if (!head || now - ray.last > RAY_SECONDS) {
				ray.outer.Destroy();
				ray.core.Destroy();
				this.rays.delete(turret);
				continue;
			}
			ray.shown += (ray.reach - ray.shown) * math.min(dt * 15, 1);
			const length = math.max(ray.length * ray.shown, 0.1);
			const from = head.CFrame.PointToWorldSpace(ray.muzzle);
			const at = CFrame.lookAt(from, from.add(head.CFrame.LookVector)).mul(new CFrame(0, 0, -length / 2));
			const width = ray.shown * (1 + 0.15 * math.sin(now * 25));
			ray.outer.Size = new Vector3(RAY_WIDTH * width, RAY_WIDTH * width, length);
			ray.core.Size = new Vector3(CORE_WIDTH * width, CORE_WIDTH * width, length);
			ray.outer.CFrame = at;
			ray.core.CFrame = at;
		}
		this.flights = this.flights.filter((flight) => {
			const { shot, part } = flight;
			if (shot.target?.Parent) flight.to = shot.target.GetPivot().Position;
			const t = (now - flight.fired) / shot.seconds;
			if (t >= 1) {
				this.vanish(part);
				this.land(flight);
				return false;
			}
			const at = bezier(shot.from, shot.control, flight.to, t);
			const ahead = bezier(shot.from, shot.control, flight.to, math.min(t + 0.02, 1));
			part.CFrame = ahead.sub(at).Magnitude > 1e-3 ? CFrame.lookAt(at, ahead) : new CFrame(at);
			return true;
		});
	}

	/** A shot coming down where it was going: flak puffs, a bullet sparks and a flame flares, blasting if it splashes; a rocket or shell blows up. */
	private land({ shot, to }: Flight) {
		if (shot.kind === "flak") return this.puff(to, shot.splash);
		if (shot.kind === "bullet" || shot.kind === "flame") {
			this.impact.WorldCFrame = CFrame.lookAt(to, shot.from);
			if (shot.kind === "flame") this.impactFire.Emit(3);
			else this.impactSparks.Emit(3 * (shot.size ?? 1));
			if (shot.splash > 0 && shot.kind === "bullet") this.blast(to, shot.splash, false);
			return;
		}
		this.blast(to, shot.splash, shot.kind === "shell");
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
