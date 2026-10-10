import Vide from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

interface CoinCounterProps {
	readonly coins: () => number;
}

export function CoinCounter({ coins }: CoinCounterProps) {
	const [shown, spring] = useSpring<number>(0);

	Vide.effect(() => spring.setGoal(coins()));

	return (
		<textlabel
			AnchorPoint={new Vector2(0.5, 0)}
			BackgroundColor3={new Color3(0, 0, 0)}
			BackgroundTransparency={0.4}
			Font={Enum.Font.GothamBold}
			Position={new UDim2(0.5, 0, 0, 16)}
			Size={UDim2.fromOffset(200, 48)}
			Text={() => `Coins: ${math.round(shown())}`}
			TextColor3={new Color3(1, 1, 1)}
			TextSize={24}
		>
			<uicorner CornerRadius={new UDim(0, 8)} />
		</textlabel>
	);
}
