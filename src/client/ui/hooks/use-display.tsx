import type { StateOf } from "@rbxts/charm";
import { useEffect, useState } from "@rbxts/react";
import { useAtom } from "@rbxts/react-charm";

import type { Screens } from "client/store/display";
import { displayAtom } from "client/store/display";

export function useDisplay(display: StateOf<typeof displayAtom>): boolean {
	const displayData = useAtom(displayAtom);
	const [result, setResult] = useState<boolean>(false);
	useEffect(() => {
		// displayData === display ? setResult(true) : setResult(false);
		setResult(displayData === display);
	}, [displayData]);
	return result;
}
