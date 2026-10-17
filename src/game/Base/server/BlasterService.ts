import { OnStart, Service } from "@flamework/core";
import { Players, StarterPack, Workspace } from "@rbxts/services";
import { t } from "@rbxts/t";

import { block, weld } from "game/Base/server/models";
import { WaveService } from "game/Base/server/WaveService";
import { BaseMessage, baseMessaging, ShotMessage, shotMessaging } from "game/Base/shared/base-network";
import { statOf } from "game/Research/server/research-store";

const MAX_RANGE = 300;
/** How fast a bullet flies, in studs a second. */
const BULLET_SPEED = 320;
/** How big a bullet looks, against a turret's 1. */
const BULLET_SIZE = 0.7;

const LIGHT = Color3.fromRGB(152, 154, 164);
const MID = Color3.fromRGB(110, 112, 128);
const DARK = Color3.fromRGB(74, 75, 83);
const YELLOW = Color3.fromRGB(255, 211, 127);

const isFireData = t.interface({ target: t.Vector3 });

/**
 * Every character's sidearm. The Blaster lives in StarterPack, so each spawn
 * gets one. The client says where it aimed; the server checks the Blaster is
 * equipped, then raycasts from its muzzle, so a client can only choose the
 * direction of a shot, never where it starts or what it hits. The bullet flies
 * for clients to see, and hurts what it hit when it lands.
 */
@Service()
export class BlasterService implements OnStart {
	private readonly lastShot = new Map<Player, number>();
	/** Counts down, so a bullet's id never meets a turret shot's (see `Shot`). */
	private shotId = -1;

	constructor(private readonly waveService: WaveService) {}

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
		Players.PlayerRemoving.Connect((player) => this.lastShot.delete(player));
	}

	private fire(player: Player, data: unknown) {
		if (!isFireData(data)) return;
		const character = player.Character;
		const blaster = character?.FindFirstChild("Blaster");
		const handle = blaster?.IsA("Tool") ? blaster.FindFirstChild("Handle") : undefined;
		const humanoid = character?.FindFirstChildOfClass("Humanoid");
		if (!character || !handle?.IsA("BasePart") || !humanoid || humanoid.Health <= 0) return;

		const now = os.clock();
		if (now - (this.lastShot.get(player) ?? -math.huge) < statOf(player.UserId, "blasterCooldown")) return;
		this.lastShot.set(player, now);

		const muzzle = handle.FindFirstChild("Muzzle");
		const origin = muzzle?.IsA("Attachment") ? muzzle.WorldPosition : handle.Position;
		const offset = data.target.sub(origin);
		// Also rejects NaN, which compares false to everything, and infinity.
		if (!(offset.Magnitude > 0.01 && offset.Magnitude < math.huge)) return;
		const direction = offset.Unit.mul(MAX_RANGE);
		const params = new RaycastParams();
		params.FilterType = Enum.RaycastFilterType.Exclude;
		params.FilterDescendantsInstances = [character];
		const result = Workspace.Raycast(origin, direction, params);

		const to = result?.Position ?? origin.add(direction);
		const seconds = to.sub(origin).Magnitude / BULLET_SPEED;
		shotMessaging.client.emitAll(ShotMessage.Fired, {
			id: this.shotId--,
			kind: "bullet",
			from: origin,
			control: origin.Lerp(to, 0.5),
			to,
			seconds,
			splash: 0,
			size: BULLET_SIZE,
			blaster: true,
		});
		const model = result?.Instance.FindFirstAncestorOfClass("Model");
		const damage = statOf(player.UserId, "blasterDamage");
		// It lands when the bullet does. An alien that's gone by then just isn't hurt (see `damageAlien`).
		if (model) task.delay(seconds, () => this.waveService.damageAlien(model, damage));
	}
}
