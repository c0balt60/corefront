import Vide, { Show } from "@rbxts/vide";
import { useAtom } from "@rbxts/vide-charm";

import { EXIT_TIME } from "core/Interface/client/motion";
import { hudVisibleAtom } from "core/Interface/client/ui-state";
import { MainMenu } from "lobby/Menu/client/components/main-menu";
import { menuOpenAtom, menuPageAtom } from "lobby/Menu/client/menu-state";
import { CreatePage } from "lobby/Servers/client/components/create-page";
import { JoinPage } from "lobby/Servers/client/components/join-page";
import { StatusOverlay } from "lobby/Servers/client/components/status-overlay";
import { statusAtom, worldsAtom } from "lobby/Servers/client/servers-state";
import { ServersMessage, serversMessaging } from "lobby/Servers/shared/servers-network";

/**
 * Everything on screen that only exists in the lobby. Core's `App` still draws
 * the shared HUD and loading screen. This is where lobby features' components
 * are wired to their atoms and messages. It sits above the HUD (DisplayOrder 10)
 * and below the loading screen, and the menu inside covers the whole screen.
 * The menu and its Create and Join pages stay mounted for `EXIT_TIME` after they
 * are closed, so their exit animations can play.
 */
export function LobbyApp() {
	const visible = useAtom(hudVisibleAtom);
	const open = useAtom(menuOpenAtom);
	const page = useAtom(menuPageAtom);
	const worlds = useAtom(worldsAtom);
	const status = useAtom(statusAtom);

	return (
		<screengui Name="LobbyApp" DisplayOrder={10} Enabled={visible} IgnoreGuiInset={true} ResetOnSpawn={false}>
			<Show when={open}>
				{(_, menuShown) =>
					$tuple(
						<MainMenu page={page} onPage={(target) => menuPageAtom(target)} show={menuShown}>
							<Show when={() => page() === "create"}>
								{(_, pageShown) =>
									$tuple(
										<CreatePage
											onCreate={(seed, isPrivate, sandbox) => {
												statusAtom({ kind: "busy", text: "Creating your world..." });
												serversMessaging.server.emit(ServersMessage.Create, {
													seed,
													isPrivate,
													sandbox,
												});
											}}
											onReturn={() => menuPageAtom("deploy")}
											show={pageShown}
										/>,
										EXIT_TIME,
									)
								}
							</Show>
							<Show when={() => page() === "join"}>
								{(_, pageShown) =>
									$tuple(
										<JoinPage
											worlds={worlds}
											onJoin={(code) => {
												statusAtom({ kind: "busy", text: "Joining world..." });
												serversMessaging.server.emit(ServersMessage.Join, { code });
											}}
											onRefresh={() => serversMessaging.server.emit(ServersMessage.RequestList)}
											onReturn={() => menuPageAtom("deploy")}
											show={pageShown}
										/>,
										EXIT_TIME,
									)
								}
							</Show>
						</MainMenu>,
						EXIT_TIME,
					)
				}
			</Show>

			{/* Outside the menu's Show, so a create or join in progress still blocks input with the menu closed. */}
			<StatusOverlay status={status} onDismiss={() => statusAtom({ kind: "idle" })} />
		</screengui>
	);
}
