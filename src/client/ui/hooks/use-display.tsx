import type { StateOf } from "@rbxts/charm";
import { useMemo } from "@rbxts/react";
import { useAtom } from "@rbxts/react-charm";

import { displayAtom } from "client/store/display";

export function useDisplay(display: StateOf<typeof displayAtom>): boolean {
	const displayData = useAtom(displayAtom);

	// NOTE - Change useDisplay into a memoized hook to reduce re-renders
	// const [result, setResult] = useState<boolean>(false);
	// useEffect(() => {
	// 	// displayData === display ? setResult(true) : setResult(false);
	// 	setResult(displayData === display);
	// 	print("DISPLAY DATA: ", displayData, display);
	// }, [displayData, display]);
	// return result;

	return useMemo(() => displayData === display, [displayData, display]);
}
