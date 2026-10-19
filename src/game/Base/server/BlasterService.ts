import { OnStart, Service } from "@flamework/core";
import { subscribe } from "@rbxts/charm";
import { Players } from "@rbxts/services";
import { t } from "@rbxts/t";

import { blasterTool } from "game/Base/server/blaster-models";
import { BaseService } from "game/Base/server/BaseService";
import { WaveService } from "game/Base/server/WaveService";
import { BaseMessage, baseMessaging, ShotMessage, shotMessaging } from "game/Base/shared/base-network";
import {
	BLASTER_ORDER,
	blasterOf,
	BLASTERS,
	blasterShot,
	blastersOf,
	type BlasterKind,
	castBlaster,
	findBlaster,
	volleyOf,
} from "game/Base/shared/blasters";
import { isCore } from "game/Base/shared/buildings";
import { cellAt } from "game/Terrain/shared/map";

/** How far from its muzzle on the server a client may say a shot left, in studs: what a running character gets ahead by in a laggy moment. */
const ORIGIN_SLACK = 8;

const isFireData = t.interface({ origin: t.Vector3, target: t.Vector3 });
const isPickData = t.interface({ x: t.integer, z: t.integer, kind: t.keyOf(BLASTERS) });

/**
 * Every character's sidearm: whichever of the Core's tier's Blasters its player picked at the Core
 * (their `Blaster` attribute, see `blasterOf`), as that Blaster's own Tool, which this swaps in when
 * the pick or the tier changes. The client draws its own shots as it fires (see `BlasterController`)
 * and says where from and at; the server checks the Blaster is out and the shot left near its
 * muzzle, then casts it the same way, so a client can only choose the direction of a shot, never what
 * it hits. Everyone else sees the server's shot, which hurts what it hit when it lands.
 */
@Service()
export class BlasterService implements OnStart {
	private readonly lastShot = new Map<Player, number>();
	/** Counts down, so a bullet's id never meets a turret shot's (see `Shot`). */
	private shotId = -1;
	private readonly tools = new Map<BlasterKind, Tool>();

	/** Whether a player may carry a Blaster yet. `TutorialService` holds it back until its step. */
	canHave: (player: Player) => boolean = () => true;

	constructor(
		private readonly baseService: BaseService,
		private readonly waveService: WaveService,
	) {}

	onStart() {
		for (const kind of BLASTER_ORDER) this.tools.set(kind, blasterTool(kind));

		baseMessaging.server.on(BaseMessage.Fire, (player, data) => this.fire(player, data));
		baseMessaging.server.on(BaseMessage.PickBlaster, (player, data) => {
			if (!isPickData(data) || !isCore(this.baseService.reachable(player, data)?.kind)) return;
			if (!blastersOf(this.baseService.coreAtom()).includes(data.kind)) return;
			player.SetAttribute("Blaster", data.kind);
			this.refresh(player);
		});
		subscribe(this.baseService.coreAtom, () => Players.GetPlayers().forEach((player) => this.refresh(player)));

		const track = (player: Player) => {
			// Each spawn brings a new Backpack, which can come a moment after the character.
			player.CharacterAdded.Connect(() => task.defer(() => this.refresh(player)));
			player.ChildAdded.Connect((child) => child.IsA("Backpack") && task.defer(() => this.refresh(player)));
			this.refresh(player);
		};
		Players.GetPlayers().forEach(track);
		Players.PlayerAdded.Connect(track);
		Players.PlayerRemoving.Connect((player) => this.lastShot.delete(player));
	}

	/**
	 * Gives a player the Blaster they fire now, if they may carry one, in place of the one they had:
	 * drawn, if that one was. Takes it away if they may not.
	 */
	refresh(player: Player) {
		const character = player.Character;
		const backpack = player.FindFirstChildOfClass("Backpack");
		if (!character || !backpack) return;
		const held = findBlaster(character);
		const had = held ?? findBlaster(backpack);
		const kind = blasterOf(player.GetAttribute("Blaster"), this.baseService.coreAtom());
		if (!this.canHave(player)) return had?.Destroy();
		if (had?.GetAttribute("Blaster") === kind) return;
		had?.Destroy();
		const tool = this.tools.get(kind)!.Clone();
		tool.Parent = backpack;
		const humanoid = character.FindFirstChildOfClass("Humanoid");
		if (held && humanoid && humanoid.Health > 0) humanoid.EquipTool(tool);
	}

	private fire(player: Player, data: unknown) {
		if (!isFireData(data)) return;
		const character = player.Character;
		const blaster = findBlaster(character);
		const handle = blaster?.FindFirstChild("Handle");
		const humanoid = character?.FindFirstChildOfClass("Humanoid");
		if (!character || !blaster || !handle?.IsA("BasePart") || !humanoid || humanoid.Health <= 0) return;

		const kind = blasterOf(blaster.GetAttribute("Blaster"), this.baseService.coreAtom());
		const gun = BLASTERS[kind];
		const now = os.clock();
		if (now - (this.lastShot.get(player) ?? -math.huge) < gun.seconds) return;
		this.lastShot.set(player, now);

		const muzzle = handle.FindFirstChild("Muzzle");
		const ours = muzzle?.IsA("Attachment") ? muzzle.WorldPosition : handle.Position;
		// Where the client drew it from, so it lands where they saw it go, unless that's too far off.
		const origin = data.origin.sub(ours).Magnitude <= ORIGIN_SLACK ? data.origin : ours;
		const offset = data.target.sub(origin);
		// Also rejects NaN, which compares false to everything, and infinity.
		if (!(offset.Magnitude > 0.01 && offset.Magnitude < math.huge)) return;
		for (const along of volleyOf(gun, offset.Unit)) this.shoot(player, character, origin, along, kind);
	}

	/**
	 * One shot from `origin` along `along` (a unit vector), drawn for everyone but `player`, who drew
	 * their own: lightning strikes at once, and the rest hurt what they reach when they land.
	 */
	private shoot(player: Player, character: Model, origin: Vector3, along: Vector3, kind: BlasterKind) {
		const gun = BLASTERS[kind];
		const [to, result] = castBlaster(gun, origin, along, [character], this.baseService.aliensFolder);
		if (gun.projectile === "arc") {
			// Fizzles where it was aimed with nothing there to strike.
			if (!this.waveService.zapNear(origin, to, gun.damage, gun.chain ?? 0, player))
				shotMessaging.client.emitExcept(player, ShotMessage.Arc, { points: [origin, to] });
			return;
		}
		const shot = blasterShot(kind, this.shotId--, origin, to);
		shotMessaging.client.emitExcept(player, ShotMessage.Fired, shot);

		// It lands when the shot does. An alien that's gone by then just isn't hurt (see `damageAlien`).
		const { damage, pierce, splash, repair } = gun;
		const model = result?.Instance.FindFirstAncestorOfClass("Model");
		// Just past where it struck, so a hit on a building's side finds the building's cell.
		const cell = result?.Instance.IsDescendantOf(this.baseService.buildingsFolder)
			? cellAt(to.X + along.X * 0.1, to.Z + along.Z * 0.1)
			: undefined;
		task.delay(shot.seconds, () => {
			if (pierce !== undefined) this.waveService.pierceAliens(origin, to, damage, undefined, pierce);
			else if (splash !== undefined) this.waveService.blastAliens(to, splash, damage, undefined);
			else if (model) this.waveService.damageAlien(model, damage);
			const building = cell !== undefined ? this.baseService.cells.get(cell) : undefined;
			if (!building) return;
			// Menders mend the team's own; everything else hurts what isn't (an enemy's or a ruin), never the team's.
			if (building.team === "player") {
				if (repair !== undefined) this.baseService.repair(building, repair);
			} else if (repair === undefined) {
				this.baseService.damage(building, damage, player);
			}
		});
	}
}
