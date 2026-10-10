# Rogen Multi-Place Template

A multi-place Roblox game template built on [roblox-ts](https://roblox-ts.com), [Flamework](https://flamework.fireboltofdeath.dev) and [Rogen](https://rogen-playfully.vercel.app/docs/v1/setups/multi-place). Code shared by every place lives in `src/core`. Code for a single place lives in `src/<place>`. Each place builds into its own Rojo project.

## Included

| Area       | Packages                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Framework  | `@flamework/core`, `@flamework/components`                                                                         |
| State      | `@rbxts/charm`, `@rbxts/charm-sync`                                                                                |
| Data       | `@rbxts/profile-store`                                                                                             |
| Networking | `@rbxts/tether` (with `@rbxts/serio`)                                                                              |
| UI         | `@rbxts/vide`, `@rbxts/vide-charm`, `@rbxts/ripple` / `@rbxts/vide-ripple`, `@rbxts/ui-labs`, `@rbxts/topbar-plus` |
| Utilities  | `@rbxts/validate-tree`, `@rbxts/janitor`, `@rbxts/sift`, `@rbxts/t`, `@rbxts/log`, `@rbxts/cmdr`                   |

## Requirements

- [Node.js](https://nodejs.org) and [pnpm](https://pnpm.io)
- [Rokit](https://github.com/rojo-rbx/rokit). `rokit install` installs [Argon](https://argon.wiki), [Rojo](https://rojo.space) and [rbxcloud](https://github.com/Sleitnick/rbxcloud). You also need the Studio plugin for whichever tool you serve with (see `tooling.json`).
- [Git LFS](https://git-lfs.com). Run `git lfs install` once, so packed `.rbxm` models are stored in LFS.

## Getting started

```console
pnpm install
pnpm dev lobby
```

Then open the lobby place in Studio and connect from the Argon plugin. Use `pnpm dev match` for the match place.

## Scripts

Every command takes a place name, which is any folder in `places/`: `lobby` or `match`. `scripts/place.mjs` runs them all, so adding a place doesn't touch `package.json`.

| Script                        | What it does                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm dev <place>`            | Runs `watch` and `serve` for the place together                                            |
| `pnpm watch <place>`          | Regenerates the place's project file with Rogen and compiles with `rbxtsc` on every change |
| `pnpm serve <place>`          | Serves the place to Studio with the `serve` tool from `tooling.json`                       |
| `pnpm build <place>...`       | Builds the given places once, ending with `places/<place>/<place>.rbxl`                    |
| `pnpm build`                  | Builds every place, one after another                                                      |
| `pnpm build <place> --open`   | Builds, then opens the place file in Studio (via `argon studio`)                           |
| `pnpm lint` / `pnpm lint:fix` | Runs ESLint and Prettier                                                                   |

Run one place's `dev` or `watch` at a time. All places share the root `flamework.build`, and two compilers writing it at once can clobber each other.

## Project layout

```
src/
  core/                       Shared by every place
    server/main.server.ts     Server entry: logger and Flamework.ignite()
    client/main.client.ts     Client entry
    shared/                   Code shared by every feature (network, logger, constants)
    <Feature>/
      server/                 -> ServerScriptService
      client/                 -> StarterPlayerScripts
      shared/                 -> ReplicatedStorage
    Teleport/                 Place ids, match modes, teleport data and the teleport helper
  lobby/                      Lobby-only features, same layout
    Loading/server/           Data loader: spawns players once their profile loads
    LobbyUi/client/           The lobby's UI root, its UiController, and its UI Labs storybook
    Queue/                    Mode queues (server), queue state and mode picker component (client), messages (shared)
  match/                      Match-only features, same layout
    Arrival/server/           Teleport receiver and data loader
    MatchUi/client/           The match's UI root, its UiController, and its UI Labs storybook
    Match/                    Round flow (server), match state and HUD component (client), messages (shared)

places/<place>/
  .rogen.json                 Sources (core + this place), the base Rojo tree, and syncback rules
  assets/                     Studio-made content: Workspace/ (the map), ServerStorage/, ReplicatedStorage/
  default.project.json        Generated by Rogen
  <place>.rbxl                Generated by pnpm build
  out/                        Generated by rbxtsc
  include/                    Generated by rbxtsc (runtime and Flamework metadata)

tsconfig.json                 Shared compiler options, and the editor view of all of src
tsconfig.<place>.json         Generated by scripts/place.mjs: compiles core + this place into places/<place>/out
scripts/                      place.mjs runs build/watch/serve/dev. publish.mjs uploads with rbxcloud.
tooling.json                  Which tool builds (.rbxl) and which serves to Studio: rojo or argon
.github/workflows/ci.yml      Lint, build and publish
```

Rogen merges `src/core` and `src/<place>` into one Rojo project. It chooses the service from the `server`, `client` or `shared` folder name. Imports are relative to `src`, for example `import { DataService } from "core/Data/server/DataService"`.

### How each place is built

Each place has its own compile. roblox-ts resolves every `require` against a single Rojo project, and Flamework writes the instance paths that match `addPathsGlob` into `include/flamework/globs.json`. Each place therefore gets its own project, `out/` and `include/`, and core is compiled once for each place.

There is only one pair of entry points, in `src/core`. Their globs (`src/*/*/server/**/*Service.ts` and similar) cover every place. Each compile keeps only the files present in that place's project, so the lobby loads core plus `src/lobby` and never sees `src/match`.

### Example features

- **Data** (core): `DataService` loads and saves profiles with ProfileStore and keeps them in a Charm atom. `ReplicationService` syncs each player's data to their own client with Charm Sync over Tether. On the client, read `playerDataAtom`. To add a saved field, add it to `core/Data/shared/player-data.ts`. Every place in the experience shares the same data store. `DataService.waitForData(player)` resolves once a player's profile has loaded, which is how each place's loader waits for it.
- **Interface** (core): `UiController` mounts the Vide `App`, which every place shares. It shows a loading screen until the player's data arrives. Components read Charm atoms through `useAtom` from `@rbxts/vide-charm`. `CoinCounter` animates with a Ripple spring. Stories live in `Interface/client/stories` and open in UI Labs. `TopbarController` adds a topbar button that toggles the HUD. `useServerTime` counts down to times the server sends.
- **Admin** (core): the Cmdr console (F2). It's open to everyone in Studio. In live servers it's limited to the place owner and `ADMIN_USER_IDS` in `CmdrService.ts`. Try `coins . 100` (`.` means yourself).
- **Character** (core): `CharacterController` waits for the character to match a validate-tree schema and gives you a fully typed rig. A Janitor cleans up per-character connections.
- **Teleport** (core): what both places need to agree on. `ENVIRONMENTS` in `environments.ts` lists the universe and place ids for staging and production. `PLACE_IDS` holds the ids for the universe the server is running in. `MATCH_MODES` lists the modes, with their player counts and round length. `MatchTeleportData` is what the lobby sends and the match reads, checked with `isMatchTeleportData`. `teleport()` retries failed teleports, and in Studio, or while a place id is 0, it only logs.
- **Loading** (lobby): `LoadingService` waits for each player's data, then spawns them and respawns them when they die. Other lobby code checks `isLoaded(player)`.
- **Queue** (lobby): `QueueService` keeps one queue per mode. A queue counts down once it reaches `minPlayers`. It launches when the countdown ends or the queue fills, which reserves a match server and teleports the group there. `QueueController` keeps `queuesAtom` in sync. `ModeSelect` is the picker, with one button per mode showing its queue size and countdown.
- **LobbyUi** / **MatchUi**: each place's own interface. See [Place-specific UI](#place-specific-ui).
- **Arrival** (match): `ArrivalService` reads each player's teleport data and checks that they came from the lobby. Anyone else is sent back. It then waits for their data. The first arrival sets the mode for the server.
- **Match** (match): `MatchService` runs one round. It waits up to 30 seconds for everyone the lobby sent, spawns them, and plays for the mode's `roundLength`. Then it rewards everyone, shows the results, and teleports everyone back to the lobby. `MatchController` keeps `matchStateAtom` in sync. `MatchHud` shows the phase and the time left. The game itself is a TODO in `MatchService.run`.

### Lobby to match and back

1. The lobby's `QueueService` launches a queue: `TeleportAsync` to `PLACE_IDS.match` with `ShouldReserveServer` and `MatchTeleportData`.
2. Leaving the lobby ends each player's profile session, which saves their data.
3. In the match, `ArrivalService` reads `GetJoinData()`, then loads each profile again with `waitForData`.
4. `MatchService` plays the round and writes rewards through `DataService.update`.
5. Players teleport back to `PLACE_IDS.lobby`. Leaving the match saves the rewards, and the lobby's `LoadingService` loads them.

Teleports don't work in Studio. A lobby playtest logs what it would have sent and leaves you in the lobby. A match playtest skips the teleport data check and runs a Practice match.

## Place-specific UI

Every place shows two UI roots side by side, each its own ScreenGui:

- **Core `App`**, mounted by `core/Interface/client/UiController`, holds the UI every place shares: the HUD and the loading screen.
- **The place's app**, mounted by `<place>/<Place>Ui/client/<Place>UiController`, holds everything that only exists in that place. Examples are `LobbyApp` and `MatchApp`.

A place feature keeps its own UI pieces and leaves mounting to the place's UI feature:

```
lobby/Queue/client/
  QueueController.ts          Network -> atoms (queuesAtom). Mounts nothing.
  queue-state.ts              The atoms
  components/mode-select.tsx  A plain Vide component. Takes sources and callbacks as props.
lobby/LobbyUi/client/
  LobbyUiController.ts        mount(LobbyApp). The lobby's only Flamework <-> Vide bridge.
  lobby-app.tsx               Wires each feature's components to its atoms and messages.
  stories/                    lobby.storybook.ts and one story per component
```

To add a screen to a place:

1. Write the component in the feature it belongs to, under `<Feature>/client/components/`. Pass in everything that changes as a source, and every action as a callback.
2. Render it in the place's app (`lobby-app.tsx` or `match-app.tsx`) and wire up its atoms and messages there.
3. Add a story next to the place's storybook.

Name the UI feature after the place (`LobbyUi`, not `Interface`). Rogen merges same-named feature folders from `core` and the place into one folder, and same-named files would collide. Place apps read `hudVisibleAtom`, so core's topbar HUD button hides them too. Core's loading screen has a higher `DisplayOrder`, so it covers place UI until data loads.

## Adding a place

1. Create `src/<place>/` and put features in it.
2. Copy `places/lobby/.rogen.json` and `places/lobby/assets/` to `places/<place>/`. In its `.rogen.json`, change `"../../src/lobby"` and `"name"`. The scripts and CI find the place from this file, and generate its tsconfig and `include/` folder.
3. Create its `<Place>Ui` feature, copied from `src/lobby/LobbyUi`.
4. Add it to both environments in `core/Teleport/shared/environments.ts`, and to the `{ lobby: 0, match: 0 }` fallback in `places.ts`. `publish.mjs` publishes every place listed there.

## Assets and syncback

Code lives only in `src`. Anything you build in Studio lives in `places/<place>/assets`, and Argon's two-way sync writes your Studio edits there:

| In Studio                  | On disk                    |
| -------------------------- | -------------------------- |
| `Workspace`                | `assets/Workspace`         |
| `ServerStorage.Assets`     | `assets/ServerStorage`     |
| `ReplicatedStorage.Assets` | `assets/ReplicatedStorage` |

To use it, run `pnpm dev <place>` and turn on two-way sync in the Argon plugin.

Content is stored in two ways:

- **Synced instances.** Argon saves each instance as a folder with an `init.meta.json` file. It suits small things you edit often: spawn points, markers, lighting rigs, a few props. They diff well in pull requests. Each place starts with a `Baseplate` and a `SpawnLocation` stored this way.
- **Packed models (`.rbxm`).** These suit big content such as a full map or a detailed model. In Studio, right-click it, choose _Save to File_, and save over the `.rbxm` in `assets/`. Git LFS stores them, through `.gitattributes`. Argon never writes `.rbxm` files, because `syncback.ignoreGlobs` in `.rogen.json` excludes them, so editing a packed model in Studio changes nothing on disk until you save it again.

The syncback rules also keep Studio away from compiled code (`out/**` and `include/**`) and skip `Camera` and `Terrain`. Argon can't filter `../../node_modules`, because it sits outside the place folder, so don't edit packages in Studio while two-way sync is on.

`pnpm build <place>` fails if the build tool can't read an asset file. Argon only logs those errors, so `scripts/place.mjs` turns them into a failed build.

## CI/CD

`.github/workflows/ci.yml` runs on GitHub Actions:

| Trigger                                | What it does                                                            |
| -------------------------------------- | ----------------------------------------------------------------------- |
| Pull request                           | Lint and build every place, and upload the `.rbxl` files as an artifact |
| Push to `main`                         | Same, then publish every place to **staging**                           |
| Push a `v*` tag (or publish a release) | Same, then publish every place to **production**                        |

Publishing runs `node scripts/publish.mjs <environment>`. It reads `ENVIRONMENTS` and calls `rbxcloud experience publish` once for each place. You can run it locally after `pnpm build`: put `RBXCLOUD_API_KEY=...` in `.env` and run `node --env-file=.env scripts/publish.mjs staging`.

### Setup

1. Create two experiences, staging and production. In each, add a place for the lobby, as the start place, and one for the match.
2. Fill in their universe and place ids in `src/core/Teleport/shared/environments.ts`. Publishing fails while any id is 0. These ids aren't secret.
3. Create an Open Cloud API key in the [Creator Dashboard](https://create.roblox.com/dashboard/credentials). Give it the **universe-places** API with **write** access for both experiences, and allow requests from any IP, because GitHub runners don't have fixed addresses.
4. In GitHub > Settings > Environments, create `staging` and `production`. Add the key to each as the secret `RBXCLOUD_API_KEY`. Never commit the key. Locally, keep it in a `.env` file, which git already ignores.
5. Optional: protect `production` with required reviewers and a `v*` tag rule, so each production publish needs an approval.

## Conventions

- **A place may import from `core` and from itself, never from another place.** The editor allows it, because the root tsconfig sees all of `src`. The place build fails, because the other place's file isn't in its project.
- **A place can't override a core file.** Rogen lets a later source replace a file at the same path. In TypeScript, imports name `core/...` or `<place>/...` explicitly, so an override would break core's imports. Give place features their own names, distinct from core's.
- **Place message ids start at 100.** Every Tether emitter shares one RemoteEvent and tags messages with a number from 0 to 255. Core's `Message` uses the low numbers, so each place's emitter starts its enum at 100. Lobby and match never run together, so their ids may overlap each other.
- **Places spawn characters themselves.** Each place's `.rogen.json` sets `Players.CharacterAutoLoads` to false, so players spawn only after their data loads. The lobby does this in `LoadingService`, and the match in `MatchService`.
- **Each place has one UI feature.** See [Place-specific UI](#place-specific-ui).
- **Singletons are found by file name.** Flamework only loads files ending in `Service`, `Controller` or `Component` (see the `addPathsGlob` calls in the entry files). Other modules load only when something imports them, so UI Labs stories never run in game.
- **Avoid service names in file names.** Rogen treats names like `fooServer`, `fooClient` or `SoundService` as routing hints. Use a `.verbatim` marker file in a folder to turn that off. `core/Admin/server/commands` does this for Cmdr's `fooServer` files.
- **Cmdr command definitions** (`commands/foo.ts`) are moved to ReplicatedStorage, so they may only use `import type`. Put the logic in `fooServer.ts`.
- **Never mutate state.** Charm atoms and player data are replaced with new tables, never edited in place.
- **Logging**: services and controllers get a `Logger` injected through their constructor. Debug logs show in development builds only (`NODE_ENV`, via `rbxts-transform-env`).
- **Studio data**: Studio uses ProfileStore's mock store, so playtests never touch live data. Change `USE_MOCK_STORE` in `DataService.ts` to test real saves.

## Notes

- Never run a bare `rbxtsc` from the root. The root `tsconfig.json` exists for shared options and the editor. Use `pnpm build`, `pnpm watch` or `pnpm dev`.
- If you delete `flamework.build`, also delete every `places/*/out`. Flamework refuses to build when it finds a stale `tsbuildinfo`.
- `pnpm-workspace.yaml` hoists `node_modules`, which is required for Argon and Rojo to resolve `@rbxts` dependencies. It also pins every transformer to roblox-ts's copy of TypeScript.
- `argon.toml` turns off Argon's project detection, so Argon doesn't start a second `rbxtsc` alongside `pnpm watch <place>`.
