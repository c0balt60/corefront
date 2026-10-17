import { OnStart, Service } from "@flamework/core";
import { Players, StarterPack, Workspace } from "@rbxts/services";
import { t } from "@rbxts/t";

import { BaseService } from "game/Base/server/BaseService";
import { block, weld } from "game/Base/server/models";
import { WaveService } from "game/Base/server/WaveService";
import { BaseMessage, baseMessaging, ShotMessage, shotMessaging } from "game/Base/shared/base-network";
import { type BlasterDef, blasterOf, BLASTERS, blastersOf, type BlasterKind } from "game/Base/shared/blasters";
import { isCore } from "game/Base/shared/buildings";
import { cellAt } from "game/Terrain/shared/map";

/** How fast bullets and flames fly, in studs a second. */
const BULLET_SPEED = 320;
const FLAME_SPEED = 60;
/** A shell's seconds in the air: this long to leave, plus its distance over its speed. */
const LAUNCH_SECONDS = 0.3;
const SHELL_SPEED = 110;

const LIGHT = Color3.fromRGB(152, 154, 164);
const MID = Color3.fromRGB(110, 112, 128);
const DARK = Color3.fromRGB(74, 75, 83);
const YELLOW = Color3.fromRGB(255, 211, 127);

const isFireData = t.interface({ target: t.Vector3 });
const isPickData = t.interface({ x: t.integer, z: t.integer, kind: t.keyOf(BLASTERS) });

/**
 * Every character's sidearm. The Blaster lives in StarterPack, so each spawn
 * gets one, and it fires whichever of the Core's tier's Blasters its player
 * picked at the Core (their `Blaster` attribute, see `blasterOf`). The
 * client says where it aimed; the server checks the Blaster is
 * equipped, then raycasts from its muzzle, so a client can only choose the
 * direction of a shot, never where it starts or what it hits. The bullet flies
 * for clients to see, and hurts what it hit when it lands.
 */
@Service()
export class BlasterService implements OnStart {
	private readonly lastShot = new Map<Player, number>();
	/** Counts down, so a bullet's id never meets a turret shot's (see `Shot`). */
	private shotId = -1;

	constructor(
		private readonly baseService: BaseService,
		private readonly waveService: WaveService,
	) {}

	onStart() {
		const tool = new Instance("Tool");
		tool.Name = "Blaster";
		tool.CanBeDropped = false;
		tool.ToolTip = "Shoot aliens";
		// A grey, yellow-trimmed gun with its barrel down -Z, held by its grip.
		const handle = new Instance("Part");
		handle.Name = "Handle";
		handle.Size = new Vector3(0.4, 0.5, 1.4);
		handle.Color = MID;
		handle.Material = Enum.Material.Metal;
		handle.CanCollide = false;
		handle.Parent = tool;
		tool.Grip = new CFrame(0, -0.55, 0.3);
		const part = (size: Vector3, at: CFrame, color: Color3, material: Enum.Material = Enum.Material.Metal) =>
			weld(handle, block(tool, size, at, color, material));
		part(new Vector3(0.3, 0.15, 1), new CFrame(0, 0.32, -0.1), LIGHT);
		part(new Vector3(0.42, 0.1, 0.25), new CFrame(0, 0.05, -0.3), YELLOW, Enum.Material.SmoothPlastic);
		part(new Vector3(0.3, 0.35, 0.4), new CFrame(0, 0, 0.9), DARK);
		part(new Vector3(0.32, 0.32, 0.5), new CFrame(0, 0.05, -0.95), LIGHT);
		part(new Vector3(0.18, 0.18, 0.5), new CFrame(0, 0.05, -1.4), DARK);
		part(new Vector3(0.28, 0.28, 0.2), new CFrame(0, 0.05, -1.65), MID);
		part(new Vector3(0.12, 0.12, 0.08), new CFrame(0, 0.05, -1.78), YELLOW, Enum.Material.Neon);
		part(new Vector3(0.28, 0.7, 0.3), new CFrame(0, -0.55, 0.4).mul(CFrame.Angles(math.rad(-12), 0, 0)), DARK);
		part(new Vector3(0.3, 0.45, 0.4), new CFrame(0, -0.45, -0.25), LIGHT);
		part(new Vector3(0.32, 0.25, 0.1), new CFrame(0, -0.45, -0.25), YELLOW, Enum.Material.Neon);
		const muzzle = new Instance("Attachment");
		muzzle.Name = "Muzzle";
		muzzle.Position = new Vector3(0, 0.05, -1.85);
		muzzle.Parent = handle;
		tool.Parent = StarterPack;

		baseMessaging.server.on(BaseMessage.Fire, (player, data) => this.fire(player, data));
		baseMessaging.server.on(BaseMessage.PickBlaster, (player, data) => {
			if (!isPickData(data) || !isCore(this.baseService.reachable(player, data)?.kind)) return;
			if (blastersOf(this.baseService.coreAtom()).includes(data.kind)) player.SetAttribute("Blaster", data.kind);
		});
		Players.PlayerRemoving.Connect((player) => this.lastShot.delete(player));
	}

	private fire(player: Player, data: unknown) {
		if (!isFireData(data)) return;
		const character = player.Character;
		const blaster = character?.FindFirstChild("Blaster");
		const handle = blaster?.IsA("Tool") ? blaster.FindFirstChild("Handle") : undefined;
		const humanoid = character?.FindFirstChildOfClass("Humanoid");
		if (!character || !handle?.IsA("BasePart") || !humanoid || humanoid.Health <= 0) return;

		const kind = blasterOf(player.GetAttribute("Blaster"), this.baseService.coreAtom());
		const gun = BLASTERS[kind];
		const now = os.clock();
		if (now - (this.lastShot.get(player) ?? -math.huge) < gun.seconds) return;
		this.lastShot.set(player, now);

		const muzzle = handle.FindFirstChild("Muzzle");
		const origin = muzzle?.IsA("Attachment") ? muzzle.WorldPosition : handle.Position;
		const offset = data.target.sub(origin);
		// Also rejects NaN, which compares false to everything, and infinity.
		if (!(offset.Magnitude > 0.01 && offset.Magnitude < math.huge)) return;
		const volley = gun.volley ?? 1;
		for (let index = 0; index < volley; index++) {
			const turn = math.rad((index - (volley - 1) / 2) * (gun.fan ?? 0));
			this.shoot(character, origin, CFrame.Angles(0, turn, 0).mul(offset.Unit), kind);
		}
	}

	/**
	 * One shot from `origin` along `along` (a unit vector), to what it meets within the Blaster's range,
	 * or the end of it: lightning strikes at once, and the rest hurt what they reach when they land.
	 */
	private shoot(character: Model, origin: Vector3, along: Vector3, kind: BlasterKind) {
		const gun: BlasterDef = BLASTERS[kind];
		const direction = along.mul(gun.range);
		const params = new RaycastParams();
		params.FilterType = Enum.RaycastFilterType.Exclude;
		params.FilterDescendantsInstances =
			gun.pierce !== undefined ? [character, this.baseService.aliensFolder] : [character];
		const result = Workspace.Raycast(origin, direction, params);
		const to = result?.Position ?? origin.add(direction);

		if (gun.projectile === "arc") {
			// Fizzles where it was aimed with nothing there to strike.
			if (!this.waveService.zapNear(origin, to, gun.damage, gun.chain ?? 0))
				shotMessaging.client.emitAll(ShotMessage.Arc, { points: [origin, to] });
			return;
		}
		const distance = to.sub(origin).Magnitude;
		const shell = gun.projectile === "shell";
		const seconds = shell
			? LAUNCH_SECONDS + distance / SHELL_SPEED
			: distance / (gun.projectile === "flame" ? FLAME_SPEED : BULLET_SPEED);
		shotMessaging.client.emitAll(ShotMessage.Fired, {
			id: this.shotId--,
			kind: gun.projectile,
			from: origin,
			control: shell ? origin.Lerp(to, 0.5).add(new Vector3(0, distance * 0.6, 0)) : origin.Lerp(to, 0.5),
			to,
			seconds,
			splash: gun.splash ?? 0,
			size: gun.size,
			blaster: kind,
		});
		// It lands when the shot does. An alien that's gone by then just isn't hurt (see `damageAlien`).
		const { damage, pierce, splash, repair } = gun;
		const model = result?.Instance.FindFirstAncestorOfClass("Model");
		// Just past where it struck, so a hit on a building's side finds the building's cell.
		const cell = result?.Instance.IsDescendantOf(this.baseService.buildingsFolder)
			? cellAt(to.X + along.X * 0.1, to.Z + along.Z * 0.1)
			: undefined;
		task.delay(seconds, () => {
			if (pierce !== undefined) this.waveService.pierceAliens(origin, to, damage, undefined, pierce);
			else if (splash !== undefined) this.waveService.blastAliens(to, splash, damage, undefined);
			else if (model) this.waveService.damageAlien(model, damage);
			const building = cell !== undefined ? this.baseService.cells.get(cell) : undefined;
			if (repair !== undefined && building) this.baseService.repair(building, repair);
		});
	}
}
