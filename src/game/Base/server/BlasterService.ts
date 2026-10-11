import { OnStart, Service } from "@flamework/core";
import { Players, StarterPack, Workspace } from "@rbxts/services";
import { t } from "@rbxts/t";

import { block, tracer, weld } from "game/Base/server/models";
import { WaveService } from "game/Base/server/WaveService";
import { BaseMessage, baseMessaging } from "game/Base/shared/base-network";

const COOLDOWN = 0.25;
const MAX_RANGE = 300;
const DAMAGE = 15;
const TRACER = Color3.fromRGB(90, 220, 255);

const isFireData = t.interface({ target: t.Vector3 });

/**
 * Every character's sidearm. The Blaster lives in StarterPack, so each spawn
 * gets one. The client says where it aimed; the server checks the Blaster is
 * equipped, then raycasts from its Handle, so a client can only choose the
 * direction of a shot, never where it starts or what it hits.
 */
@Service()
export class BlasterService implements OnStart {
	private readonly lastShot = new Map<Player, number>();

	constructor(private readonly waveService: WaveService) {}

	onStart() {
		const tool = new Instance("Tool");
		tool.Name = "Blaster";
		tool.CanBeDropped = false;
		tool.ToolTip = "Shoot aliens";
		const handle = new Instance("Part");
		handle.Name = "Handle";
		handle.Size = new Vector3(0.4, 0.6, 2);
		handle.Color = Color3.fromRGB(46, 48, 56);
		handle.Material = Enum.Material.Metal;
		handle.CanCollide = false;
		handle.Parent = tool;
		weld(handle, block(tool, new Vector3(0.25, 0.25, 0.8), new CFrame(0, 0.2, -0.7), TRACER, Enum.Material.Neon));
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
		if (now - (this.lastShot.get(player) ?? -math.huge) < COOLDOWN) return;
		this.lastShot.set(player, now);

		const origin = handle.Position;
		const offset = data.target.sub(origin);
		// Also rejects NaN, which compares false to everything.
		if (!(offset.Magnitude > 0.01)) return;
		const direction = offset.Unit.mul(MAX_RANGE);
		const params = new RaycastParams();
		params.FilterType = Enum.RaycastFilterType.Exclude;
		params.FilterDescendantsInstances = [character];
		const result = Workspace.Raycast(origin, direction, params);

		tracer(origin, result?.Position ?? origin.add(direction), TRACER);
		const model = result?.Instance.FindFirstAncestorOfClass("Model");
		if (model) this.waveService.damageAlien(model, DAMAGE);
	}
}
