import Vide from "@rbxts/vide";

import { useAppear, useSpin } from "core/Interface/client/motion";
import { COLORS } from "core/Interface/client/theme";

interface SpinnerProps {
	readonly anchorPoint?: Vector2;
	readonly position?: UDim2;
	readonly size?: UDim2;
	/** Turns false to fade it away. Return `$tuple(node, EXIT_TIME)` from the Show that renders it. */
	readonly show?: () => boolean;
}

const clamp01 = (value: number) => math.clamp(value, 0, 1);

/**
 * Two rings that fade out along one half, the outer one turning one way and the inner one the other, with a
 * pulsing core between them. Both speed up and slow down as they turn, so it reads as working rather than looping.
 * It fades in, and needs no image assets.
 */
export function Spinner({ anchorPoint, position, size, show }: SpinnerProps) {
	const appear = useAppear(show);
	const hidden = () => 1 - clamp01(appear());

	const outer = useSpin(() => 300 + 140 * math.sin(os.clock() * 1.6));
	const inner = useSpin(() => -220 - 90 * math.sin(os.clock() * 1.1));
	// One beat per turn of the outer ring.
	const beat = () => 0.5 + 0.5 * math.sin(math.rad(outer()));

	return (
		<frame
			AnchorPoint={anchorPoint}
			BackgroundTransparency={1}
			Position={position}
			Size={size ?? UDim2.fromScale(0.2, 0.2)}
		>
			<uiaspectratioconstraint AspectRatio={1} />
			<uicorner CornerRadius={new UDim(0.5, 0)} />
			<uistroke Color={COLORS.accent} Thickness={5} Transparency={hidden}>
				<uigradient Rotation={outer} Transparency={new NumberSequence(0, 1)} />
			</uistroke>

			<frame
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(0.5, 0.5)}
				Size={UDim2.fromScale(0.62, 0.62)}
			>
				<uicorner CornerRadius={new UDim(0.5, 0)} />
				<uistroke Color={COLORS.text} Thickness={2} Transparency={hidden}>
					<uigradient Rotation={inner} Transparency={new NumberSequence(0.3, 1)} />
				</uistroke>
			</frame>

			<frame
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundColor3={COLORS.accent}
				BackgroundTransparency={() => 1 - (1 - 0.5 * beat()) * clamp01(appear())}
				Position={UDim2.fromScale(0.5, 0.5)}
				Size={() => UDim2.fromScale(0.08 + 0.05 * beat(), 0.08 + 0.05 * beat())}
			>
				<uicorner CornerRadius={new UDim(0.5, 0)} />
			</frame>
		</frame>
	);
}

interface PulseDotProps {
	readonly anchorPoint?: Vector2;
	readonly position?: UDim2;
	/** Diameter in pixels. */
	readonly size?: number;
	readonly color?: () => Color3;
}

/** A status light: a dot that breathes, with a ring that pings out from it and fades, over and over. */
export function PulseDot({ anchorPoint, position, size = 8, color = () => COLORS.accent }: PulseDotProps) {
	// One ping every 1.5 seconds. Starts at a random point of the cycle, so dots side by side don't pulse as one.
	const ping = useSpin(() => 240);
	const progress = () => ping() / 360;

	return (
		<frame
			AnchorPoint={anchorPoint}
			BackgroundTransparency={1}
			Position={position}
			Size={UDim2.fromOffset(size, size)}
		>
			<frame
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(0.5, 0.5)}
				Size={() => UDim2.fromOffset(size * (1 + 2.2 * progress()), size * (1 + 2.2 * progress()))}
			>
				<uicorner CornerRadius={new UDim(0.5, 0)} />
				<uistroke Color={color} Thickness={1} Transparency={() => 0.3 + 0.7 * progress()} />
			</frame>
			<frame
				BackgroundColor3={color}
				BackgroundTransparency={() => 0.1 + 0.3 * (0.5 + 0.5 * math.sin(math.rad(ping())))}
				Size={UDim2.fromScale(1, 1)}
			>
				<uicorner CornerRadius={new UDim(0.5, 0)} />
			</frame>
		</frame>
	);
}
