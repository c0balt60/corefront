import { Workspace } from "@rbxts/services";
import Vide, { cleanup } from "@rbxts/vide";

import { useSpin } from "core/Interface/client/motion";
import { COLORS } from "core/Interface/client/theme";

/** An outline round a thing in the world that shows through walls, with a fill that pulses. Off without a target, which would outline its whole parent. Gone with its scope. Renders nothing: it lives in the Workspace, out of Vide's tree. */
export function TutorialHighlight({ target }: { readonly target: () => PVInstance | undefined }) {
	// A turn a second, whose sine is the pulse.
	const phase = useSpin(() => 360);

	cleanup(
		(
			<highlight
				Name="TutorialHighlight"
				Adornee={target}
				Enabled={() => target() !== undefined}
				DepthMode={Enum.HighlightDepthMode.AlwaysOnTop}
				FillColor={COLORS.accent}
				FillTransparency={() => 0.7 + 0.2 * math.sin(math.rad(phase()))}
				OutlineColor={COLORS.accent}
				Parent={Workspace}
			/>
		) as Highlight,
	);
}
