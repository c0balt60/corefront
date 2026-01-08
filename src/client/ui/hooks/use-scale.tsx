import { useContext } from "@rbxts/react";
import type UIScaler from "@rbxts/ui-scaler";

import { ScalerContext } from "../context/scaler-context";

export function useScale(): UIScaler.ScalerApi {
	const context = useContext(ScalerContext);
	assert(
		context,
		"ScalerContext not found. Did you call it outside of ScalerContext? Try wrapping around RootProvider or ScaleProvider",
	);
	return context;
}
