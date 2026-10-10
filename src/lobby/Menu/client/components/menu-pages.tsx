import Vide from "@rbxts/vide";

import { Panel } from "core/Interface/client/components/panel";
import { PulseDot } from "core/Interface/client/components/spinner";
import { useScramble } from "core/Interface/client/motion";
import { COLORS, FONT, FONT_DISPLAY } from "core/Interface/client/theme";
import { MenuCard } from "lobby/Menu/client/components/menu-card";
import { PageHeading, ReturnButton, Reveal } from "lobby/Menu/client/components/page-parts";
import type { MenuPage } from "lobby/Menu/client/menu-state";

interface PageProps {
	/** Turns false while the page is leaving, so its parts play their exit. */
	readonly show?: () => boolean;
}

interface NavigatingProps extends PageProps {
	readonly onPage: (page: MenuPage) => void;
}

/** The four big cards: Deploy on the left, then Store, Settings and Changelog. */
export function HomePage({ onPage, show }: NavigatingProps) {
	return (
		<>
			<MenuCard
				title="DEPLOY"
				tag="01"
				subtitle="Create or join a world"
				titleHeight={0.075}
				size={UDim2.fromScale(0.4, 1)}
				onClick={() => onPage("deploy")}
				show={show}
			/>
			<MenuCard
				title="STORE"
				tag="02"
				subtitle="Spend your coins on in-game items"
				titleHeight={0.15}
				position={UDim2.fromScale(0.425, 0)}
				size={UDim2.fromScale(0.575, 0.475)}
				onClick={() => onPage("store")}
				show={show}
				delay={0.06}
			/>
			<MenuCard
				title="SETTINGS"
				tag="03"
				subtitle="Tweak the game to your liking"
				titleHeight={0.135}
				anchorPoint={new Vector2(0, 1)}
				position={UDim2.fromScale(0.425, 1)}
				size={UDim2.fromScale(0.275, 0.475)}
				onClick={() => onPage("settings")}
				show={show}
				delay={0.12}
			/>
			<MenuCard
				title="CHANGELOG"
				tag="04"
				subtitle="See what is new"
				titleHeight={0.135}
				anchorPoint={new Vector2(0, 1)}
				position={UDim2.fromScale(0.725, 1)}
				size={UDim2.fromScale(0.275, 0.475)}
				onClick={() => onPage("changelog")}
				show={show}
				delay={0.18}
			/>
		</>
	);
}

/** Two tall cards: make a new world or join one. */
export function DeployPage({ onPage, show }: NavigatingProps) {
	return (
		<>
			<MenuCard
				title="CREATE"
				tag="01"
				subtitle="Create your own world"
				titleHeight={0.085}
				size={UDim2.fromScale(0.49, 0.88)}
				onClick={() => onPage("create")}
				show={show}
			/>
			<MenuCard
				title="JOIN"
				tag="02"
				subtitle="Join a public world or enter a code"
				titleHeight={0.085}
				position={UDim2.fromScale(0.51, 0)}
				size={UDim2.fromScale(0.49, 0.88)}
				onClick={() => onPage("join")}
				show={show}
				delay={0.06}
			/>
			<ReturnButton onClick={() => onPage("home")} show={show} delay={0.12} />
		</>
	);
}

interface PlaceholderPageProps extends PageProps {
	readonly title: string;
	readonly onReturn: () => void;
}

/** A page that is not built yet: a panel with a pulsing light over a decoding "module offline" readout. */
export function PlaceholderPage({ title, onReturn, show }: PlaceholderPageProps) {
	const message = useScramble("text", () => "MODULE OFFLINE", 0.3, 0.6);

	return (
		<>
			<PageHeading title={title} subtitle="Coming soon" show={show} />
			<Reveal
				show={show}
				delay={0.06}
				scale={0.97}
				position={UDim2.fromScale(0, 0.2)}
				size={UDim2.fromScale(1, 0.62)}
			>
				<Panel>
					<PulseDot anchorPoint={new Vector2(0.5, 0.5)} position={UDim2.fromScale(0.5, 0.4)} size={10} />
					<textlabel
						AnchorPoint={new Vector2(0.5, 0)}
						BackgroundTransparency={1}
						FontFace={FONT_DISPLAY}
						Position={UDim2.fromScale(0.5, 0.47)}
						Size={UDim2.fromScale(0.6, 0.1)}
						Text={message}
						TextColor3={COLORS.subtext}
						TextScaled={true}
					/>
					<textlabel
						AnchorPoint={new Vector2(0.5, 0)}
						BackgroundTransparency={1}
						FontFace={FONT}
						Position={UDim2.fromScale(0.5, 0.58)}
						Size={UDim2.fromScale(0.6, 0.06)}
						Text="This section has not been built yet."
						TextColor3={COLORS.muted}
						TextScaled={true}
					/>
				</Panel>
			</Reveal>
			<ReturnButton onClick={onReturn} show={show} delay={0.08} />
		</>
	);
}
