import type { ReactNode } from "@rbxts/react";
import React, { useMemo, useRef, useState } from "@rbxts/react";

import type { Route, State } from "../context/state-context";
import { StateContext } from "../context/state-context";

interface IScreenProps {
	children: ReactNode;
	initialScreen?: Route;
}

export function ScreenProvider({ initialScreen, children }: Readonly<IScreenProps>): ReactNode {
	const [screen, setScreen] = useState<Route>(initialScreen ?? "Loading");
	const [previousScreen, setPreviousScreen] = useState<Route | undefined>(undefined);

	// Current ui state
	const inTransition = useRef(false);

	/**
	 * Transition function
	 */
	const transition = (nextState: Route): void => {
		if (inTransition.current) {
			return;
		}

		if (nextState === screen) {
			return;
		}

		inTransition.current = true;
		setPreviousScreen(screen);

		task.delay(1, () => {
			setScreen(nextState);

			task.delay(1, () => {
				setPreviousScreen(undefined);
				inTransition.current = false;
			});
		});
	};

	const value = useMemo<State>((): State => {
		return { current: screen, into: transition, prev: previousScreen };
	}, [screen, previousScreen]);

	return <StateContext.Provider value={value}>{children}</StateContext.Provider>;
}
