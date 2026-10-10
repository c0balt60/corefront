import Vide from "@rbxts/vide";
import { useAtom } from "@rbxts/vide-charm";

import { playerDataAtom } from "core/Data/client/data-state";
import { CoinCounter } from "core/Interface/client/components/coin-counter";
import { hudVisibleAtom } from "core/Interface/client/ui-state";

/**
 * The interface every place shares. Places mount their own screens from their
 * controllers. A Vide component body runs once: anything that can change must
 * reach the tree as a source (a function), never a plain value.
 */
export function App() {
	const data = useAtom(playerDataAtom);
	const visible = useAtom(hudVisibleAtom);

	return (
		<>
			<screengui Name="App" Enabled={visible} ResetOnSpawn={false}>
				<CoinCounter coins={() => data()?.coins ?? 0} />
			</screengui>

			{/* Places spawn characters only after data loads, so this covers the wait. */}
			<screengui
				Name="Loading"
				DisplayOrder={100}
				Enabled={() => data() === undefined}
				IgnoreGuiInset={true}
				ResetOnSpawn={false}
			>
				<textlabel
					BackgroundColor3={new Color3(0.08, 0.08, 0.1)}
					Font={Enum.Font.GothamBold}
					Size={UDim2.fromScale(1, 1)}
					Text="Loading..."
					TextColor3={new Color3(1, 1, 1)}
					TextSize={32}
				/>
			</screengui>
		</>
	);
}
