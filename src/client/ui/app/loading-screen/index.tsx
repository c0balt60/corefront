import {
	useMotion,
	useMouse,
	useTimer,
	useUnmountEffect,
	useUpdate,
	useViewport,
} from "@rbxts/pretty-react-hooks";
import type { ReactNode } from "@rbxts/react";
import React, { useEffect, useMemo, useRef, useState } from "@rbxts/react";
import { useAtom } from "@rbxts/react-charm";
import { TweenService } from "@rbxts/services";

import { displayAtom } from "client/store/display";
import { transitionAtom } from "client/store/transition";
import { DelayRender } from "client/ui/components/delay-render";
import { useScreenContext } from "client/ui/context";
import { usePx, useTheme } from "client/ui/hooks";
import { useDisplay } from "client/ui/hooks/use-display";

function sweep(bar: Frame): { cancel: () => void } {
	let cancelled = false;
	let tween: Tween | undefined;

	bar.Size = UDim2.fromScale(0.3, 1);
	const initial = UDim2.fromScale(-bar.Size.X.Scale, 0.5);
	bar.Position = initial;

	const run = (): void => {
		if (cancelled) {
			return;
		}

		bar.Position = initial;

		tween = TweenService.Create(bar, new TweenInfo(1, Enum.EasingStyle.Quad), {
			Position: UDim2.fromScale(2, 0.5),
		});

		tween.Completed.Once(() => {
			tween = undefined;
			if (cancelled) {
				return;
			}

			task.delay(0.1, run);
		});

		tween.Play();
	};

	run();

	return {
		cancel: () => {
			cancelled = true;
			bar.Position = UDim2.fromScale(0, 0.5);
		},
	};
}

export default function LoadingScreen(): ReactNode {
	const update = useUpdate();
	const timer = useTimer();
	const theme = useTheme();
	const px = usePx();
	const display = useDisplay("loading-screen");
	const displayedAtom = useAtom(displayAtom);

	const barRef = useRef<Frame>();

	const textTransparency = timer.value.map((time) => math.sin(time * 2) * 0.5 + 0.5);

	const [dotCount, setDotCount] = useState<number>(0);
	const [assetsText, setAssetsText] = useState<string>("Assets Loading");

	const [loadSize, loadSizeMotion] = useMotion<UDim2>(UDim2.fromScale(0, 0));
	const [loadPosition, loadPositionMotion] = useMotion<UDim2>(UDim2.fromScale(0, 0.5));

	const [xSize, setXSize] = useMotion(1);
	const [scaleMotion, setScaleMotion] = useMotion(1);

	useEffect(() => {
		const bar = barRef.current;
		if (!bar) {
			update();
			return;
		}

		// For any internal state
		let cancelled = false;
		let cancelledLoad = false;

		// Set initial spring values
		loadSizeMotion.set(UDim2.fromScale(0.3, 1));
		loadPositionMotion.set(UDim2.fromScale(-0.3, 0.5));

		// Create inf loop handle
		const handle = sweep(bar);

		// Constant dot animation
		setDotCount(0);
		const tickDots = (): void => {
			if (cancelled) {
				return;
			}

			setDotCount((previous) => (previous + 1) % 4);
			task.delay(0.25, tickDots);
		};

		tickDots();

		// Wait assets
		const load = new Promise<void>((resolve) => {
			// Start loading assets
			task.wait(3);
			cancelled = true;
			handle.cancel();

			resolve();
		}).andThen(() => {
			setDotCount(0);
			loadSizeMotion.set(UDim2.fromScale(0, 1));
			loadPositionMotion.spring(UDim2.fromScale(0, 0.5));

			task.wait(1);

			let percent = 0;

			for (let index = 0; index < 20; index++) {
				if (cancelledLoad) {
					return;
				}

				loadSizeMotion.spring(UDim2.fromScale((percent += math.random(1, 15) * 0.01), 1), {
					damping: 1,
					frequency: 5,
				});
				setAssetsText(string.format("Assets Loading: %d", percent * 100));
				task.wait(0.1);
			}

			task.wait(1);

			setXSize.spring(0);
			task.wait(1);
			setScaleMotion.spring(20);

			setScaleMotion.onComplete(() => {
				transitionAtom({ delay: 3, type: "in" });
				task.wait(1);
				displayAtom("main-menu");
			});

			print("ANIMATING ==> into main-menu");
			// screen.into("Main");
		});

		return () => {
			handle.cancel();
			cancelled = true;
			cancelledLoad = true;
			load.cancel();
		};
	}, [update, loadSizeMotion, loadPositionMotion, setXSize, setScaleMotion, display]);

	useEffect(() => {
		setAssetsText(`Assets Loading${".".rep(dotCount)}${" ".rep(3 - dotCount)}`);
	}, [dotCount]);

	useEffect(() => {
		// if (display) {
		// 	print(display);
		// 	return;
		// }
		// warn("display unmount: ", display, displayedAtom);
	}, [display, setXSize, setScaleMotion]);

	return (
		<DelayRender ShouldRender={display} UnmountDelay={1}>
			<frame
				key="loading-screen"
				BackgroundColor3={Color3.fromRGB(31, 31, 31)}
				BackgroundTransparency={1}
				Size={UDim2.fromScale(1, 1)}
			>
				<textlabel
					key="Header"
					AnchorPoint={new Vector2(0.5, 0.5)}
					BackgroundTransparency={1}
					FontFace={Font.fromName(
						theme.fonts.primary.regular.Name,
						Enum.FontWeight.SemiBold,
					)}
					Position={UDim2.fromScale(0.5, 0.5)}
					Size={UDim2.fromScale(0.3, 0.125)}
					Text="COREFRONT"
					TextColor3={new Color3(1, 1, 1)}
					TextScaled={true}
				/>
				<textlabel
					key="HeaderShadow"
					AnchorPoint={new Vector2(0.5, 0.5)}
					BackgroundTransparency={1}
					FontFace={Font.fromName(
						theme.fonts.primary.regular.Name,
						Enum.FontWeight.SemiBold,
					)}
					Position={new UDim2(0.5, px(5), 0.5, px(5))}
					Size={UDim2.fromScale(0.3, 0.125)}
					Text="COREFRONT"
					TextColor3={Color3.fromRGB(244, 121, 110)}
					TextScaled={true}
					ZIndex={0}
				>
					<uistroke
						Color={Color3.fromRGB(62, 62, 62)}
						StrokeSizingMode={Enum.StrokeSizingMode.ScaledSize}
						Thickness={0.07}
					/>
				</textlabel>
				<frame
					key="Line"
					AnchorPoint={new Vector2(0.5, 0.5)}
					BackgroundColor3={Color3.fromRGB(244, 121, 110)}
					Position={UDim2.fromScale(0.5, 0.51)}
					Size={UDim2.fromScale(0.5, 0.01)}
					ZIndex={-1}
				>
					<uistroke
						Color={Color3.fromRGB(62, 62, 62)}
						StrokeSizingMode={Enum.StrokeSizingMode.ScaledSize}
						Thickness={0.55}
					/>
					<uiaspectratioconstraint AspectRatio={94} />
				</frame>
				<frame
					key="Bottom"
					AnchorPoint={new Vector2(0.5, 1)}
					BackgroundTransparency={1}
					Position={UDim2.fromScale(0.5, 0.95)}
					Size={UDim2.fromScale(0.8, 0.3)}
					ZIndex={2}
				>
					<textlabel
						key="Loading"
						AnchorPoint={new Vector2(0.5, 1)}
						BackgroundTransparency={1}
						FontFace={Font.fromName(
							theme.fonts.primary.regular.Name,
							Enum.FontWeight.SemiBold,
						)}
						Position={UDim2.fromScale(0.5, 0.7)}
						Size={UDim2.fromScale(0.3, 0.125)}
						Text="Loading"
						TextColor3={Color3.fromRGB(220, 220, 220)}
						TextScaled={true}
						TextTransparency={textTransparency}
					/>
					<textlabel
						key="Tips"
						AnchorPoint={new Vector2(0.5, 1)}
						BackgroundTransparency={1}
						FontFace={Font.fromName(
							theme.fonts.primary.regular.Name,
							Enum.FontWeight.SemiBold,
						)}
						Position={UDim2.fromScale(0.5, 0.825)}
						Size={UDim2.fromScale(0.3, 0.075)}
						Text="The quick brown fox jumps over the lazy dog"
						TextColor3={Color3.fromRGB(116, 116, 116)}
						TextScaled={true}
					/>
					<textlabel
						key="Assets"
						AnchorPoint={new Vector2(0.5, 1)}
						BackgroundTransparency={1}
						FontFace={Font.fromName(
							theme.fonts.primary.regular.Name,
							Enum.FontWeight.SemiBold,
						)}
						Position={UDim2.fromScale(0.5, 1)}
						Size={UDim2.fromScale(0.3, 0.085)}
						Text={assetsText}
						TextColor3={Color3.fromRGB(116, 116, 116)}
						TextScaled={true}
					/>
					<canvasgroup
						key="LoadingBar"
						AnchorPoint={new Vector2(0.5, 0.5)}
						BackgroundColor3={new Color3(0, 0, 0)}
						BackgroundTransparency={0.8}
						Position={UDim2.fromScale(0.5, 0.875)}
						Size={xSize.map((value) => UDim2.fromScale(0.6 * value, 0.03))}
					>
						<uistroke
							Color={Color3.fromRGB(122, 122, 122)}
							StrokeSizingMode={Enum.StrokeSizingMode.ScaledSize}
							Thickness={0.1}
							Transparency={0.5}
						/>
						<uicorner CornerRadius={new UDim(0.5, 0)} />
						<frame
							key="Bar"
							ref={barRef}
							AnchorPoint={new Vector2(0, 0.5)}
							Position={loadPosition}
							Size={loadSize}
						/>
					</canvasgroup>
				</frame>
			</frame>
		</DelayRender>
	);
}
