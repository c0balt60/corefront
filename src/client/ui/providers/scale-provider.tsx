import type { PropsWithChildren, ReactNode } from "@rbxts/react";
import React from "@rbxts/react";
import { useScaler } from "@rbxts/ui-scaler";

import { BASE_RESOLUTION } from "shared/constants/resolution";

import { ScalerContext } from "../context/scaler-context";

export function ScaleProvider({ children }: Readonly<PropsWithChildren>): ReactNode {
	return (
		<ScalerContext.Provider value={useScaler(BASE_RESOLUTION)}>
			{children}
		</ScalerContext.Provider>
	);
}
