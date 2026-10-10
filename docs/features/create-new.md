# Creating a feature

A feature is one folder that holds everything for one piece of the game: its server logic, client logic, shared types, messages and UI. This guide walks through adding one. The example is a lobby `Shop`.

## 1. Pick where it lives

| Use                     | When                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| `src/core/<Feature>`    | Every place needs it, for example data, admin or character.              |
| `src/<place>/<Feature>` | Only one place needs it, for example the lobby queue or the match round. |

A place may import from `core` and from itself, never from another place. The editor won't stop you, because it sees all of `src`, but that place's build will fail.

Never give a place feature the same name as a core feature, such as `Interface` or `Data`. Rogen merges same-named folders into one, and their files collide.

## 2. Lay out the folders

```
src/lobby/Shop/
  server/                     -> ServerScriptService
    ShopService.ts
  client/                     -> StarterPlayerScripts
    ShopController.ts
    shop-state.ts
    components/shop-panel.tsx
  shared/                     -> ReplicatedStorage
    shop-network.ts
```

Rogen sends each file to a Roblox service based on the name of its `server`, `client` or `shared` folder. Leave out any folder the feature doesn't need.

Imports are written relative to `src`, for example `import { ShopService } from "lobby/Shop/server/ShopService"`.

If `pnpm dev <place>` is running, Rogen notices the new folder by itself. If you see a "Could not find Rojo data" error, run `pnpm build <place>` once.

## 3. Services and controllers

Flamework loads singletons **by file name**. The entry points in `src/core/server` and `src/core/client` load:

| File name ends in | Folder                            | Loaded on     |
| ----------------- | --------------------------------- | ------------- |
| `Service.ts`      | `server/`                         | Server        |
| `Controller.ts`   | `client/`                         | Client        |
| `Component.ts`    | `server/`, `client/` or `shared/` | Matching side |

Any other module, such as state, components or helpers, only runs when something imports it.

```ts
import { OnStart, Service } from "@flamework/core";
import type { Logger } from "@rbxts/log";

import { DataService } from "core/Data/server/DataService";

@Service()
export class ShopService implements OnStart {
	constructor(
		private readonly logger: Logger,
		private readonly dataService: DataService,
	) {}

	onStart() {
		this.logger.Info("Shop ready");
	}
}
```

- **Dependencies** come in through the constructor. Any service or controller can be injected, and so can `Logger`, which comes already tagged with the class name.
- **Lifecycle:** use `OnStart` for setup that relies on other singletons. Use `OnInit` only when another singleton needs this one set up first.
- **Player data:** read it with `DataService.waitForData(player)` and change it with `DataService.update`. To add a saved field, edit `core/Data/shared/player-data.ts`.
- **State:** never mutate it in place. Atoms and player data always get new tables.

**Flamework components** are for behaviour attached to tagged instances. Name the file `<Name>Component.ts` and use `@Component({ tag: "<Tag>" })` from `@flamework/components`.

## 4. Networking

Every feature that talks across the network defines its own Tether emitter in `shared/`:

```ts
import { MessageEmitter } from "@rbxts/tether";

export const shopMessaging = MessageEmitter.create<ShopMessageData>();

export const enum ShopMessage {
	Buy = 110,
	Request,
	State,
}

export interface ShopMessageData {
	/** Client -> server: buy an item. */
	[ShopMessage.Buy]: { readonly itemId: string };
	/** Client -> server: the client is listening and wants the current stock. */
	[ShopMessage.Request]: undefined;
	/** Server -> client: the current stock. */
	[ShopMessage.State]: { readonly stock: Array<string> };
}
```

**Message ids:** every emitter shares one RemoteEvent, and each message is tagged with a number from 0 to 255.

- Ids must be unique among everything loaded in one place. That means core's messages plus that place's messages.
- Core's `Message` enum in `core/shared/network.ts` uses the low numbers. A core feature can add its messages there.
- Place features start at 100. Give each emitter its own block of ids. The lobby's `Queue` uses 100 to 103, so the example `Shop` starts at 110.
- The lobby and the match never run together, so their ids may overlap.

**Sending:**

| Call                                                         | Direction            |
| ------------------------------------------------------------ | -------------------- |
| `shopMessaging.server.emit(ShopMessage.Buy, data)`           | Client to server     |
| `shopMessaging.client.emit(player, ShopMessage.State, data)` | Server to one player |
| `shopMessaging.client.emitAll(...)`                          | Server to everyone   |

**Receiving:** listen with `.server.on(...)` on the server and `.client.on(...)` on the client.

**The Request/State pattern** is how features keep client state in sync. See `lobby/Queue` for a complete example.

1. The server pushes `State` whenever the data changes.
2. The controller listens for `State` and writes it into an atom.
3. On start, the controller emits `Request`, and the server replies with the current `State`. This way a client that starts listening late still gets the data.

**Validate everything the client sends** on the server. Never trust ids, amounts or item names coming from a client. `@rbxts/t` is installed for this.

## 5. UI

Feature UI is made of plain Vide components. Only one controller per place mounts UI.

1. **State:** create `client/<feature>-state.ts` with Charm atoms, such as `export const stockAtom = atom<ReadonlyArray<string>>([])`. Your controller writes to them.
2. **Component:** create `client/components/<name>.tsx`. Pass in every value that changes as a source, and every action as a callback. Don't import atoms or emitters inside the component. That keeps it usable in a story.
3. **Wire it up** in the place's app:
    - For a place feature, render it in `lobby/LobbyUi/client/lobby-app.tsx` or `match/MatchUi/client/match-app.tsx`.
    - For a core feature, render it in `core/Interface/client/app.tsx`.
    - In the app, read atoms with `useAtom` from `@rbxts/vide-charm`, and turn callbacks into emits.
4. **Story:** add `<name>.story.tsx` next to the place's storybook, for example `lobby/LobbyUi/client/stories/`. Use UI Labs controls in place of real data. `mode-select.story.tsx` is a good model.

Place apps already respect `hudVisibleAtom`, which the topbar HUD button toggles. Core's loading screen covers all UI until the player's data loads.

## 6. Check it

```console
pnpm build <place>
pnpm lint
```

Then playtest with `pnpm dev <place>`. Server and client logs show which singletons started.

## Checklist

- [ ] The folder is in `core` or one place, and its name doesn't match a core feature.
- [ ] Singletons end in `Service`, `Controller` or `Component`.
- [ ] Message ids don't overlap with any other emitter in the same place.
- [ ] Everything the client sends is validated on the server.
- [ ] The component takes props and doesn't import atoms. It has a story.
- [ ] `pnpm build` and `pnpm lint` pass.
