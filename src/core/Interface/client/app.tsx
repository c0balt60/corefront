import { ContentProvider, RunService } from "@rbxts/services";
import Vide, { cleanup, Show, source } from "@rbxts/vide";
import { useAtom } from "@rbxts/vide-charm";

import { playerDataAtom } from "core/Data/client/data-state";
import { CoinCounter } from "core/Interface/client/components/coin-counter";
import { LoadingScreen } from "core/Interface/client/components/loading-screen";
import { IMAGES } from "core/Interface/client/theme";
import { hudVisibleAtom, loadedAtom } from "core/Interface/client/ui-state";

/** The loading screen stays at least this long, so the tips can be read and the bar does not jump. */
const MIN_LOADING_SECONDS = 2;

/**
 * The interface every place shares. Places mount their own screens from their
 * controllers. A Vide component body runs once: anything that can change must
 * reach the tree as a source (a function), never a plain value.
 */
export function App() {
	const data = useAtom(playerDataAtom);
	const visible = useAtom(hudVisibleAtom);
	const loaded = useAtom(loadedAtom);

	// Loading means every UI image preloaded, the player's data arrived and the minimum time passed.
	const images = new Array<string>();
	for (const [, id] of pairs(IMAGES)) images.push(id);

	const preloaded = source(0);
	task.spawn(() => {
		ContentProvider.PreloadAsync(images, () => preloaded(math.min(preloaded() + 1, images.size())));
		preloaded(images.size());
	});

	const startedAt = os.clock();
	const waited = source(0);
	const timer = RunService.Heartbeat.Connect(() => {
		waited(math.min((os.clock() - startedAt) / MIN_LOADING_SECONDS, 1));
		if (waited() >= 1) timer.Disconnect();
	});
	cleanup(timer);

	const progress = () => math.min(waited(), (preloaded() + (data() !== undefined ? 1 : 0)) / (images.size() + 1));
	const done = () => progress() >= 1;

	return (
		<>
			<screengui Name="App" Enabled={visible} ResetOnSpawn={false}>
				<CoinCounter coins={() => data()?.coins ?? 0} />
			</screengui>

			{/* Places spawn characters only after data loads, so this covers the wait. */}
			<screengui
				Name="Loading"
				DisplayOrder={100}
				Enabled={() => !loaded()}
				IgnoreGuiInset={true}
				ResetOnSpawn={false}
			>
				<Show when={() => !loaded()}>
					{() => <LoadingScreen progress={progress} done={done} onFinished={() => loadedAtom(true)} />}
				</Show>
			</screengui>
		</>
	);
}
