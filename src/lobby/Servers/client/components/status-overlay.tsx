import Vide, { Show } from "@rbxts/vide";
import { useSpring } from "@rbxts/vide-ripple";

import { Button } from "core/Interface/client/components/button";
import { Modal } from "core/Interface/client/components/panel";
import { Spinner } from "core/Interface/client/components/spinner";
import { EXIT_TIME, useAppear, useScramble } from "core/Interface/client/motion";
import { COLORS, FONT, FONT_DISPLAY, SPRINGS } from "core/Interface/client/theme";
import { Reveal } from "lobby/Menu/client/components/page-parts";
import type { ServersStatus } from "lobby/Servers/client/servers-state";

interface StatusOverlayProps {
	readonly status: () => ServersStatus;
	/** Called when the player dismisses an error. */
	readonly onDismiss: () => void;
}

/**
 * Covers the screen while a create or join is running (a spinner), or after one failed (an ERROR tag, a message
 * and OK). The dialog pops in and out, and keeps showing its last status while it leaves.
 */
export function StatusOverlay({ status, onDismiss }: StatusOverlayProps) {
	return (
		<Show
			when={() => {
				const current = status();
				// Nothing while idle. The Show keeps the last value it was given, so the dialog keeps its text as it leaves.
				return current.kind === "idle" ? undefined : current;
			}}
		>
			{(current, show) =>
				$tuple(
					// An error draws its own message, which shakes, so the dialog's text stays empty for it.
					<Modal show={show} text={() => (current().kind === "busy" ? current().text : "")}>
						<Show when={() => current().kind === "busy"}>
							{(_, visible) =>
								$tuple(
									<Spinner
										anchorPoint={new Vector2(0.5, 0)}
										position={UDim2.fromScale(0.5, 0.64)}
										size={UDim2.fromScale(0.3, 0.3)}
										show={visible}
									/>,
									EXIT_TIME,
								)
							}
						</Show>
						<Show when={() => current().kind === "error"}>
							{(_, visible) =>
								$tuple(
									<>
										<ErrorText text={() => current().text} show={visible} />
										<Reveal
											show={visible}
											anchorPoint={new Vector2(0.5, 0)}
											position={UDim2.fromScale(0.5, 0.68)}
											size={UDim2.fromScale(0.3, 0.2)}
										>
											<Button
												text="OK"
												color={COLORS.confirm}
												onClick={onDismiss}
												anchorPoint={new Vector2(0.5, 0.5)}
												position={UDim2.fromScale(0.5, 0.5)}
												size={UDim2.fromScale(1, 1)}
											/>
										</Reveal>
									</>,
									EXIT_TIME,
								)
							}
						</Show>
					</Modal>,
					EXIT_TIME,
				)
			}
		</Show>
	);
}

interface ErrorTextProps {
	readonly text: () => string;
	readonly show: () => boolean;
}

/**
 * The message of a failed create or join, laid over the dialog's empty text, under a red ERROR tag. Both decode as
 * they fade in, and the message shakes once.
 */
function ErrorText({ text, show }: ErrorTextProps) {
	const appear = useAppear(show);
	const [shake, shakeSpring] = useSpring<number>(0, SPRINGS.bouncy);
	const tag = useScramble("dialog", () => "ERROR", 0, 0.3);
	const message = useScramble("dialog", text, 0.1, 0.5);
	// A sideways kick that rings out around the centre.
	shakeSpring.impulse(600);

	return (
		<>
			<textlabel
				AnchorPoint={new Vector2(0.5, 0)}
				BackgroundTransparency={1}
				FontFace={FONT_DISPLAY}
				Position={() => new UDim2(0.5, shake(), 0.05, 0)}
				Size={UDim2.fromScale(0.4, 0.1)}
				Text={tag}
				TextColor3={COLORS.danger}
				TextScaled={true}
				TextTransparency={() => 1 - math.clamp(appear(), 0, 1)}
			/>
			<textlabel
				AnchorPoint={new Vector2(0.5, 0)}
				BackgroundTransparency={1}
				FontFace={FONT}
				Position={() => new UDim2(0.5, shake(), 0.18, 0)}
				Size={UDim2.fromScale(0.88, 0.42)}
				Text={message}
				TextColor3={COLORS.text}
				TextScaled={true}
				TextTransparency={() => 1 - math.clamp(appear(), 0, 1)}
			>
				<uitextsizeconstraint MaxTextSize={40} />
			</textlabel>
		</>
	);
}
