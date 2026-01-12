import { useMotion } from "@rbxts/pretty-react-hooks";
import type { ReactNode } from "@rbxts/react";
import React, { useEffect } from "@rbxts/react";
import { useAtom } from "@rbxts/react-charm";

import { transitionAtom } from "client/store/transition";

export function Transition(): ReactNode {
	const transition = useAtom(transitionAtom);

	const [transparencyMotion, setTransparencyMotion] = useMotion(0);

	useEffect(() => {
		if (transition.type === "idle") {
			setTransparencyMotion.set(1);
			return;
		}

		let cancelled = false;
		const animate = new Promise(() => {
			setTransparencyMotion.spring(0);
			task.wait(transition.delay);
			if (cancelled) {
				return;
			}

			setTransparencyMotion.spring(1);
		});

		return () => {
			cancelled = true;
			animate.cancel();
		};
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
