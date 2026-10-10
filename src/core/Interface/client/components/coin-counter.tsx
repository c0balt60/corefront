import Vide, { effect } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Brackets, EnergyGradient, ScanSweep } from "core/Interface/client/components/hud";
import { Shadow } from "core/Interface/client/components/shadow";
import { useScramble } from "core/Interface/client/motion";
import { CARD_TRANSPARENCY, COLORS, FONT_DISPLAY, FONT_LABEL, SPRINGS } from "core/Interface/client/theme";

interface CoinCounterProps {
	readonly coins: () => number;
}

/**
 * The coin readout at the top of the screen. The number rolls up or down to its new value on a spring. Every change
 * also pops the number and flushes it with the accent colour, lights the outline and brackets, runs a scan line
 * across the box and re-decodes the COINS label, like a terminal acknowledging an update.
 */
export function CoinCounter({ coins }: CoinCounterProps) {
	const [shown, spring] = useSpring<number>(0);
	// 1 on every change, easing back to 0.
	const [flash, flashSpring] = useSpring<number>(0, SPRINGS.smooth);
	const label = useScramble(
		"chip",
		() => {
			coins();
			return "COINS";
		},
		0.1,
		0.35,
	);

	effect((last: number | undefined) => {
		const current = coins();
		spring.setGoal(current);
		// Flashes on every change after the first.
		if (last !== undefined && current !== last) {
			flashSpring.setPosition(1);
			flashSpring.setGoal(0);
		}
		return current;
	}, undefined);

	return (
		<frame
			Name="CoinCounter"
			AnchorPoint={new Vector2(0.5, 0)}
			BackgroundTransparency={1}
			Position={new UDim2(0.5, 0, 0, 16)}
			Size={UDim2.fromOffset(220, 44)}
		>
			<Shadow lift={flash} glow={COLORS.accent} scale={0.6} />
			<frame
				BackgroundColor3={COLORS.card}
				BackgroundTransparency={CARD_TRANSPARENCY}
				Size={UDim2.fromScale(1, 1)}
				ZIndex={1}
			>
				<uicorner CornerRadius={new UDim(0, 6)} />
				<uistroke ApplyStrokeMode={Enum.ApplyStrokeMode.Border} Color={COLORS.text} Thickness={1.5}>
					<EnergyGradient
						kind="chip"
						base={() => COLORS.stroke.Lerp(COLORS.accent, math.clamp(flash(), 0, 1) * 0.7)}
						charge={flash}
					/>
				</uistroke>
				<textlabel
					AnchorPoint={new Vector2(0, 0.5)}
					BackgroundTransparency={1}
					FontFace={FONT_LABEL}
					Position={UDim2.fromScale(0.07, 0.5)}
					Size={UDim2.fromScale(0.35, 0.4)}
					Text={label}
					TextColor3={COLORS.muted}
					TextScaled={true}
					TextXAlignment={Enum.TextXAlignment.Left}
				/>
				<textlabel
					AnchorPoint={new Vector2(1, 0.5)}
					BackgroundTransparency={1}
					FontFace={FONT_DISPLAY}
					Position={UDim2.fromScale(0.93, 0.5)}
					Size={UDim2.fromScale(0.5, 0.6)}
					Text={() => tostring(math.round(shown()))}
					TextColor3={() => COLORS.text.Lerp(COLORS.accent, math.clamp(flash(), 0, 1))}
					TextScaled={true}
					TextXAlignment={Enum.TextXAlignment.Right}
				>
					<uiscale Scale={() => 1 + 0.2 * flash()} />
				</textlabel>
			</frame>
			<ScanSweep kind="chip" trigger={coins} duration={0.6} zIndex={2} />
			<Brackets kind="chip" open={flash} length={8} thickness={1.5} />
		</frame>
	);
}
