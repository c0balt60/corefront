import Vide from "@rbxts/vide";

import { IMAGES, SHADOW_EDGE, SHADOW_SLICE } from "core/Interface/client/theme";

const BLACK = new Color3(0, 0, 0);

interface ShadowProps {
	/** 0 rests close to the surface. 1 is raised: wider, softer, further down, and tinted with `glow`. */
	readonly lift: () => number;
	/** The colour a raised shadow glows. `tint` (black) for a plain drop shadow. */
	readonly glow?: Color3;
	/** The shadow's colour at rest. Black unless given, as for a glow round something coloured. */
	readonly tint?: () => Color3;
	/** Multiplies the shadow's reach, so small things like buttons get smaller shadows. */
	readonly scale?: number;
	/** 0-1 opacity, for fading the shadow in and out with its frame. */
	readonly visibility?: () => number;
}

/**
 * A soft 9-slice shadow filling its parent, plus how far it spreads. It sits at
 * ZIndex 0, so put it next to the frame it shadows, never inside it.
 */
export function Shadow({ lift, glow, tint = () => BLACK, scale = 1, visibility = () => 1 }: ShadowProps) {
	const spread = () => (14 + 18 * lift()) * scale;

	return (
		<imagelabel
			Name="Shadow"
			AnchorPoint={new Vector2(0.5, 0.5)}
			BackgroundTransparency={1}
			Image={IMAGES.shadow}
			ImageColor3={() => tint().Lerp(glow ?? tint(), math.clamp(lift(), 0, 1) * 0.6)}
			ImageTransparency={() => 1 - (0.55 + 0.2 * lift()) * visibility()}
			Position={() => new UDim2(0.5, 0, 0.5, (3 + 7 * lift()) * scale)}
			ScaleType={Enum.ScaleType.Slice}
			SliceCenter={SHADOW_SLICE}
			SliceScale={() => math.max((spread() * 2) / SHADOW_EDGE, 0.01)}
			Size={() => new UDim2(1, spread() * 2, 1, spread() * 2)}
			ZIndex={0}
		/>
	);
}
