import { Controller, OnStart } from "@flamework/core";
import { computed, effect, untracked } from "@rbxts/charm";
import { Workspace } from "@rbxts/services";
import { mount } from "@rbxts/vide";

import { COLORS } from "core/Interface/client/theme";
import { baseStateAtom } from "game/Base/client/base-state";
import { groundRing } from "game/Base/client/BuildController";
import { DROP_ZONE_RADIUS } from "game/Base/shared/buildings";
import { Glyph } from "game/Research/client/components/glyphs";

/** How wide the warning sign over each drop zone is, and how high over its centre it floats, in studs. */
const SIGN_STUDS = 16;
const SIGN_HEIGHT = 24;
/** How high the glow rises off each drop zone's ring, fading as it goes, in studs. */
const WALL_STUDS = 20;

/**
 * Marks the drop zones, where aliens land: a red ring round each on the ground, like a turret's
 * range, with a glow rising off it so it shows from afar, and a warning sign floating over its centre. Nothing builds inside, and anyone standing
 * there when an alien lands dies.
 */
@Controller()
export class DropZoneController implements OnStart {
	onStart() {
		// Changes only when the zones move, so the state's every update doesn't redraw them.
		const zones = computed(() => (baseStateAtom()?.dropZones ?? []).map((zone) => tostring(zone)).join(";"));
		effect(() => {
			zones();
			return untracked(() => this.mark(baseStateAtom()?.dropZones ?? []));
		});
	}

	/** Draws the marks round `zones` until the returned cleanup runs. */
	private mark(zones: ReadonlyArray<Vector3>): () => void {
		const cleanups = zones.map((zone) => {
			const clearRing = groundRing(zone, DROP_ZONE_RADIUS, COLORS.danger, WALL_STUDS);
			// On Terrain, which sits at the origin, so its position is where it is in the world.
			const anchor = new Instance("Attachment");
			anchor.Position = zone.add(new Vector3(0, SIGN_HEIGHT, 0));
			anchor.Parent = Workspace.Terrain;
			const sign = new Instance("BillboardGui");
			sign.LightInfluence = 0;
			sign.Size = UDim2.fromScale(SIGN_STUDS, SIGN_STUDS);
			sign.Parent = anchor;
			const unmount = mount(
				() => Glyph({ glyph: "warning", color: COLORS.danger, background: COLORS.card }),
				sign,
			);
			return () => {
				unmount();
				anchor.Destroy();
				clearRing();
			};
		});
		return () => cleanups.forEach((cleanup) => cleanup());
	}
}
