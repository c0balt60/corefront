import { createContext, useContext } from "@rbxts/react";

export type Route = "Loading" | "Main";

export interface State {
	current: Route;
	into: (next: Route) => void;
	prev?: Route | undefined;
}

export const StateContext = createContext<State>({
	current: "Loading",
	into: () => {
		return;
	},
});

export function useScreenContext(): State {
	const context = useContext(StateContext);
	// eslint-disable-next-line ts/strict-boolean-expressions -- Disregard
	assert(context, "Global context not initiated. ");
	return context;
}
