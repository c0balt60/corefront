import Vide, { Case, derive, effect, source, Switch } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Brackets } from "core/Interface/client/components/hud";
import { MenuBackground } from "core/Interface/client/components/menu-background";
import { EXIT_TIME, useAppear, useScramble } from "core/Interface/client/motion";
import { COLORS, FONT_LABEL, SPRINGS } from "core/Interface/client/theme";
import { DeployPage, HomePage, PlaceholderPage } from "lobby/Menu/client/components/menu-pages";
import type { MenuPage } from "lobby/Menu/client/menu-state";

interface NavItem {
	readonly text: string;
	readonly page: MenuPage;
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
	{ text: "HOME", page: "home" },
	{ text: "STORE", page: "store" },
	{ text: "SETTINGS", page: "settings" },
	{ text: "CHANGELOG", page: "changelog" },
];

interface MainMenuProps {
	readonly page: () => MenuPage;
	readonly onPage: (page: MenuPage) => void;
	/** Turns false to play the exit. Return `$tuple(node, EXIT_TIME)` from the Show that renders the menu. */
	readonly show?: () => boolean;
	/** The Create and Join pages. They belong to the Servers feature, so the place's app passes them in. */
	readonly children?: Vide.Node;
}

/**
 * The full-screen menu: the background, the current page and the nav bar. It fades in as one with the
 * content easing up, the nav bar rising and each page animating in and out as the page changes. Every page's
 * titles decode and its panels scan as it arrives.
 */
export function MainMenu({ page, onPage, show = () => true, children }: MainMenuProps) {
	const appear = useAppear(show);

	return (
		<canvasgroup
			Name="MainMenu"
			BackgroundTransparency={1}
			GroupTransparency={() => 1 - math.clamp(appear(), 0, 1)}
			Size={UDim2.fromScale(1, 1)}
		>
			<MenuBackground />

			{/* Pages keep one aspect ratio, so cards and panels keep their proportions on any screen. */}
			<frame
				Name="Content"
				AnchorPoint={new Vector2(0.5, 0.5)}
				BackgroundTransparency={1}
				Position={() => new UDim2(0.5, 0, 0.46, (1 - appear()) * 24)}
				Size={UDim2.fromScale(0.7, 0.65)}
				ZIndex={1}
			>
				<uiscale Scale={() => 0.96 + 0.04 * appear()} />
				<uiaspectratioconstraint AspectRatio={1.9} />
				<Switch condition={page}>
					<Case match="home">
						{(visible) => $tuple(<HomePage onPage={onPage} show={visible} />, EXIT_TIME)}
					</Case>
					<Case match="deploy">
						{(visible) => $tuple(<DeployPage onPage={onPage} show={visible} />, EXIT_TIME)}
					</Case>
					<Case match="store">
						{(visible) =>
							$tuple(
								<PlaceholderPage title="STORE" onReturn={() => onPage("home")} show={visible} />,
								EXIT_TIME,
							)
						}
					</Case>
					<Case match="settings">
						{(visible) =>
							$tuple(
								<PlaceholderPage title="SETTINGS" onReturn={() => onPage("home")} show={visible} />,
								EXIT_TIME,
							)
						}
					</Case>
					<Case match="changelog">
						{(visible) =>
							$tuple(
								<PlaceholderPage title="CHANGELOG" onReturn={() => onPage("home")} show={visible} />,
								EXIT_TIME,
							)
						}
					</Case>
				</Switch>
				{children}
			</frame>

			<NavBar page={page} onPage={onPage} show={show} />
		</canvasgroup>
	);
}

interface NavBarProps {
	readonly page: () => MenuPage;
	readonly onPage: (page: MenuPage) => void;
	readonly show: () => boolean;
}

/**
 * The black bar along the bottom, rising in after the menu, with a hairline of light along its top edge. A
 * targeting reticle of corner brackets rests round the current page's
 * item and springs to whichever item is hovered, charging up while it is aimed at one.
 */
function NavBar({ page, onPage, show }: NavBarProps) {
	const rise = useAppear(show, 0.1);
	const hovered = source<number | undefined>(undefined);
	// Create, Join and the rest of Deploy belong to Home, which is the first item.
	const active = derive(() =>
		math.max(
			NAV_ITEMS.findIndex((item) => item.page === page()),
			0,
		),
	);
	// The reticle's centre, as a fraction of the nav items' width.
	const reticleGoal = () => ((hovered() ?? active()) + 0.5) / NAV_ITEMS.size();
	const [reticle, reticleSpring] = useSpring<number>(reticleGoal(), SPRINGS.responsive);
	// 0.2 while the reticle rests on the current page, 1 while it is aimed at a hovered item.
	const [aim, aimSpring] = useSpring<number>(0.2, SPRINGS.responsive);

	effect(() => reticleSpring.setGoal(reticleGoal()));
	effect(() => aimSpring.setGoal(hovered() !== undefined ? 1 : 0.2));

	return (
		<frame
			Name="NavBar"
			AnchorPoint={new Vector2(0, 1)}
			BackgroundColor3={COLORS.card}
			Position={() => UDim2.fromScale(0, 1 + (1 - rise()) * 0.075)}
			Size={UDim2.fromScale(1, 0.075)}
			ZIndex={2}
		>
			<frame
				BackgroundColor3={COLORS.accent}
				BackgroundTransparency={0.4}
				BorderSizePixel={0}
				Size={new UDim2(1, 0, 0, 1)}
			>
				<uigradient
					Transparency={
						new NumberSequence([
							new NumberSequenceKeypoint(0, 1),
							new NumberSequenceKeypoint(0.5, 0),
							new NumberSequenceKeypoint(1, 1),
						])
					}
				/>
			</frame>
			<frame
				AnchorPoint={new Vector2(0.5, 0)}
				BackgroundTransparency={1}
				Position={UDim2.fromScale(0.5, 0)}
				Size={UDim2.fromScale(0.5, 1)}
			>
				<frame
					Name="Reticle"
					AnchorPoint={new Vector2(0.5, 0.5)}
					BackgroundTransparency={1}
					Position={() => UDim2.fromScale(reticle(), 0.5)}
					Size={UDim2.fromScale(0.7 / NAV_ITEMS.size(), 0.62)}
				>
					<Brackets kind="nav" open={aim} length={8} thickness={1.5} />
				</frame>
				{NAV_ITEMS.map((item, index) => (
					<NavButton item={item} index={index} hovered={hovered} active={active} onPage={onPage} />
				))}
			</frame>
		</frame>
	);
}

interface NavButtonProps {
	readonly item: NavItem;
	readonly index: number;
	/** The index of the hovered item, shared so the reticle can follow it. */
	readonly hovered: Vide.Source<number | undefined>;
	readonly active: () => number;
	readonly onPage: (page: MenuPage) => void;
}

/**
 * One nav item. Its text decodes as the bar rises, one item after another, brightens and swells on hover, and stays
 * half lit on the current page.
 */
function NavButton({ item, index, hovered, active, onPage }: NavButtonProps) {
	const [lit, litSpring] = useSpring<number>(0, SPRINGS.responsive);
	const label = useScramble("nav", () => item.text, 0.3 + index * 0.07, 0.35);

	effect(() => litSpring.setGoal(hovered() === index ? 1 : active() === index ? 0.6 : 0));

	return (
		<textbutton
			AnchorPoint={new Vector2(0.5, 0.5)}
			BackgroundTransparency={1}
			FontFace={FONT_LABEL}
			Position={UDim2.fromScale((index + 0.5) / NAV_ITEMS.size(), 0.5)}
			Size={UDim2.fromScale(1 / NAV_ITEMS.size(), 1)}
			Text={label}
			TextColor3={() => COLORS.muted.Lerp(COLORS.text, math.clamp(lit(), 0, 1))}
			TextScaled={true}
			MouseEnter={() => hovered(index)}
			MouseLeave={() => {
				if (hovered() === index) hovered(undefined);
			}}
			Activated={() => onPage(item.page)}
		>
			<uiscale Scale={() => 1 + 0.1 * lit()} />
			<uipadding PaddingBottom={new UDim(0.325, 0)} PaddingTop={new UDim(0.325, 0)} />
		</textbutton>
	);
}
