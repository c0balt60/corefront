import { RunService } from "@rbxts/services";
import Vide, { cleanup, effect, source } from "@rbxts/vide";
import { useAtom } from "@rbxts/vide-charm";
import { useSpring } from "@rbxts/vide-ripple";

import { IMAGES, SPRINGS } from "core/Interface/client/theme";
import {
	screenEffectColorAtom,
	screenEffectIntensityAtom,
	screenEffectPulseAtom,
} from "core/Interface/client/ui-state";

/** Seconds per throb while it pulses. */
const THROB_PERIOD = 0.9;
/** How thick each edge is, as a fraction of the screen's height. */
const EDGE_THICKNESS = 0.2;

/** Where each copy of the edge sits, and how far it's turned. Turned ones swap axes, so all share one size. */
const EDGES = [
	{ position: UDim2.fromScale(0.5, 0.9), rotation: 0 },
	{ position: UDim2.fromScale(0.5, 0.1), rotation: 180 },
	{ position: UDim2.fromScale(0.05, 0.5), rotation: 90 },
	{ position: UDim2.fromScale(0.95, 0.5), rotation: -90 },
];

/**
 * A vignette closing in from the screen's edges, driven by the `screenEffect` atoms in `ui-state`.
 * One edge gradient drawn four times and turned, rather than one stretched image, so it keeps its
 * thickness on any screen shape. Its strength springs to each new intensity instead of flickering
 * on every change, and while the pulse is above 0 it throbs. Invisible at 0, so it can stay mounted.
 */
export function ScreenEffect() {
	const color = useAtom(screenEffectColorAtom);
	const intensity = useAtom(screenEffectIntensityAtom);
	const pulse = useAtom(screenEffectPulseAtom);
	const beat = source(0);
	cleanup(
		RunService.Heartbeat.Connect(() => {
			if (pulse() > 0) beat(os.clock());
		}),
	);

	const [shown, shownSpring] = useSpring(0, SPRINGS.smooth);
	effect(() => shownSpring.setGoal(math.clamp(intensity(), 0, 1)));

	const transparency = () => {
		const wave = 0.5 - 0.5 * math.cos((beat() / THROB_PERIOD) * 2 * math.pi);
		return 1 - shown() * (1 - math.clamp(pulse(), 0, 1) * wave);
	};

	return (
		<frame Name="ScreenEffect" BackgroundTransparency={1} Size={UDim2.fromScale(1, 1)}>
			{EDGES.map(({ position, rotation }) => (
				<imagelabel
					AnchorPoint={new Vector2(0.5, 0.5)}
					BackgroundTransparency={1}
					Image={IMAGES.edge}
					ImageColor3={color}
					ImageTransparency={transparency}
					Position={position}
					Rotation={rotation}
					Size={UDim2.fromScale(1, EDGE_THICKNESS)}
				/>
			))}
		</frame>
	);
}
