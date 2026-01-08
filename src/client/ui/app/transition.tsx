import { useMotion } from "@rbxts/pretty-react-hooks";
import type { Binding, ReactNode } from "@rbxts/react";
import React, { useEffect, useState } from "@rbxts/react";

interface ITransitionProps {
	setTransition: (value: boolean) => void;
	transition: Binding<boolean>;
}

export function Transition({ setTransition, transition }: Readonly<ITransitionProps>): ReactNode {
	const [transparencyMotion, setTransparencyMotion] = useMotion(1);

	useEffect(() => {
		print("transition: ", transition.getValue());
		// setTransparency(transition.getValue() ? 0 : 1);
		setTransparencyMotion.spring(transition.getValue() ? 0 : 1);
	}, [transition, setTransparencyMotion]);

	return (
		<frame
			key="transition"
			BackgroundColor3={new Color3(0, 0, 0)}
			BackgroundTransparency={transparencyMotion}
			Size={UDim2.fromScale(1, 1)}
		/>
	);
}
