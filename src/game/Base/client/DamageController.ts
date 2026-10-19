import { Controller, OnStart } from "@flamework/core";
import { RunService, Workspace } from "@rbxts/services";

/** What the parts of a wreck darken toward, and the most of the way they get there, at no health. */
const CHAR = Color3.fromRGB(28, 24, 22);
const MOST_CHARRED = 0.6;
/** Health, as a share of the most, under which a model sparks, smokes and burns. */
const SPARKING = 0.75;
const SMOKING = 0.5;
const BURNING = 0.25;
/** Sparks a hit throws off. */
const HIT_SPARKS = 4;
/**
 * A wreck: how fast a flier's falls (studs per second per second) and how far it noses over on the
 * way down, in radians, then how long it lies before it sinks, and how long sinking takes.
 */
const GRAVITY = 80;
const NOSE_DIVE = 0.6;
const LIE_SECONDS = 2;
const SINK_SECONDS = 3;

/** A damaged model's effects, made at its first hit. */
interface Wreck {
	readonly sparks: ParticleEmitter;
	readonly smoke: ParticleEmitter;
	readonly fire: ParticleEmitter;
	/** Its parts' colours before they darkened. */
	readonly colors: Map<BasePart, Color3>;
	health: number;
}

/** An emitter on `parent`, off till its turn, with `texture` drawn from `size` to `endSize` studs. */
function emitter(parent: BasePart, texture: string, size: number, endSize: number): ParticleEmitter {
	const particles = new Instance("ParticleEmitter");
	particles.Texture = texture;
	particles.Enabled = false;
	particles.Size = new NumberSequence(size, endSize);
	particles.Rotation = new NumberRange(0, 360);
	particles.EmissionDirection = Enum.NormalId.Top;
	particles.Parent = parent;
	return particles;
}

/**
 * Shows how hurt aliens and buildings are on the models themselves, in place of health bars: under
 * `SPARKING` they spark, under `SMOKING` they smoke, under `BURNING` they burn, and they darken as
 * their health falls. Every hit throws off a few sparks.
 */
@Controller()
export class DamageController implements OnStart {
	private readonly wrecks = new Map<Model, Wreck>();
	private readonly terrain = new RaycastParams();

	onStart() {
		this.terrain.FilterType = Enum.RaycastFilterType.Include;
		this.terrain.FilterDescendantsInstances = [Workspace.Terrain];
		task.spawn(() => {
			const base = Workspace.WaitForChild("Base");
			for (const name of ["Buildings", "Aliens"]) {
				const folder = base.WaitForChild(name);
				for (const child of folder.GetChildren()) if (child.IsA("Model")) this.watch(child);
				folder.ChildAdded.Connect((child) => {
					if (child.IsA("Model")) this.watch(child);
				});
			}
			const wrecks = base.WaitForChild("Wrecks");
			for (const child of wrecks.GetChildren()) if (child.IsA("Model")) task.spawn(() => this.sink(child));
			wrecks.ChildAdded.Connect((child) => {
				if (child.IsA("Model")) this.sink(child);
			});
		});
	}

	/**
	 * A dead alien (the server blows it up, see `WaveService`): it goes black, falls to the ground if
	 * it was flying, lies there burning `LIE_SECONDS`, then sinks out of sight.
	 */
	private sink(model: Model) {
		for (const part of model.GetDescendants()) {
			if (!part.IsA("BasePart")) continue;
			part.Color = CHAR;
			if (part.Material === Enum.Material.Neon) part.Material = Enum.Material.Metal;
		}
		const [box, size] = model.GetBoundingBox();
		const bottom = box.Y - size.Y / 2;
		const ground = Workspace.Raycast(box.Position, new Vector3(0, -1000, 0), this.terrain);
		const drop = math.max(bottom - (ground?.Position.Y ?? bottom), 0);
		const start = model.GetPivot();
		let fallen = 0;
		let speed = 0;
		while (fallen < drop && model.Parent) {
			const [dt] = RunService.Heartbeat.Wait();
			speed += GRAVITY * dt;
			fallen = math.min(fallen + speed * dt, drop);
			const tilt = CFrame.Angles(-NOSE_DIVE * (fallen / drop), 0, 0);
			model.PivotTo(start.sub(new Vector3(0, fallen, 0)).mul(tilt));
		}
		task.wait(LIE_SECONDS);
		const landed = model.GetPivot();
		let sunk = 0;
		while (sunk < 1 && model.Parent) {
			const [dt] = RunService.Heartbeat.Wait();
			sunk = math.min(sunk + dt / SINK_SECONDS, 1);
			model.PivotTo(landed.sub(new Vector3(0, sunk * (size.Y + 1), 0)));
		}
	}

	private watch(model: Model) {
		const changed = model.GetAttributeChangedSignal("Health").Connect(() => this.update(model));
		model.Destroying.Connect(() => {
			changed.Disconnect();
			this.wrecks.delete(model);
		});
		this.update(model);
	}

	private update(model: Model) {
		const health = model.GetAttribute("Health");
		const max = model.GetAttribute("MaxHealth");
		if (!typeIs(health, "number") || !typeIs(max, "number") || max <= 0) return;
		const share = math.clamp(health / max, 0, 1);
		let wreck = this.wrecks.get(model);
		if (!wreck) {
			if (share >= 1) return;
			const made = this.wreck(model, health);
			if (!made) return;
			wreck = made;
		}

		if (health < wreck.health) wreck.sparks.Emit(HIT_SPARKS);
		wreck.health = health;
		wreck.sparks.Enabled = share < SPARKING;
		wreck.smoke.Enabled = share < SMOKING;
		wreck.smoke.Rate = share < BURNING ? 12 : 5;
		wreck.fire.Enabled = share < BURNING;
		const charred = MOST_CHARRED * (1 - share);
		for (const [part, color] of wreck.colors) part.Color = color.Lerp(CHAR, charred);
	}

	private wreck(model: Model, health: number): Wreck | undefined {
		const root = model.PrimaryPart;
		if (!root) return undefined;
		const scale = math.clamp(model.GetExtentsSize().Magnitude / 8, 0.5, 4);
		const colors = new Map<BasePart, Color3>();
		for (const part of model.GetDescendants()) {
			if (part.IsA("BasePart") && part.Material !== Enum.Material.Neon && part.Transparency < 1)
				colors.set(part, part.Color);
		}
		const sparks = emitter(root, "rbxasset://textures/particles/sparkles_main.dds", 0.4 * scale, 0);
		sparks.Color = new ColorSequence(Color3.fromRGB(255, 220, 140), Color3.fromRGB(255, 120, 40));
		sparks.LightEmission = 1;
		sparks.Lifetime = new NumberRange(0.2, 0.5);
		sparks.Speed = new NumberRange(10, 20);
		sparks.SpreadAngle = new Vector2(70, 70);
		sparks.Acceleration = new Vector3(0, -40, 0);
		sparks.Rate = 3;

		const smoke = emitter(root, "rbxasset://textures/particles/smoke_main.dds", scale, 4 * scale);
		smoke.Color = new ColorSequence(Color3.fromRGB(70, 66, 62), Color3.fromRGB(20, 20, 20));
		smoke.Transparency = new NumberSequence(0.4, 1);
		smoke.Lifetime = new NumberRange(1.5, 2.5);
		smoke.Speed = new NumberRange(3, 6);
		smoke.SpreadAngle = new Vector2(20, 20);
		smoke.RotSpeed = new NumberRange(-30, 30);

		const fire = emitter(root, "rbxasset://textures/particles/fire_main.dds", 1.5 * scale, 0.3 * scale);
		fire.Color = new ColorSequence(Color3.fromRGB(255, 170, 60), Color3.fromRGB(200, 50, 20));
		fire.LightEmission = 0.8;
		fire.Transparency = new NumberSequence(0.2, 1);
		fire.Lifetime = new NumberRange(0.4, 0.8);
		fire.Speed = new NumberRange(2, 5);
		fire.SpreadAngle = new Vector2(15, 15);
		fire.Rate = 20;

		const wreck: Wreck = { sparks, smoke, fire, colors, health };
		this.wrecks.set(model, wreck);
		return wreck;
	}
}
