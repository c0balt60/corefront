# Architecture

## How each place is built

Rogen merges `src/core` and `src/<place>` into a single Rojo project. A file's Roblox service comes from its `server`, `client` or `shared` folder name. Imports are relative to `src`, for example `import { DataService } from "core/Data/server/DataService"`.

Each place has its own compile, with its own generated `tsconfig.<place>.json`, `out/` and `include/`, so core is compiled once per place. The only entry points are in `src/core`. Their globs (`src/*/*/server/**/*Service.ts` and similar) cover every place, and each compile keeps only the files in its own project. The lobby never sees `src/game`.

## Lobby to game

1. **Create** (`lobby/Servers/server/ServersService.ts`): reserves a game server and registers a join code in the MemoryStore `Worlds` registry (`core/Worlds/server/registry.ts`). It then teleports the player with `WorldTeleportData` (`{ code }`).
2. **Join**: looks up the code, or picks a public world from the registry list, and teleports.
3. **Arrival** (`game/Arrival/server/ArrivalService.ts`): checks that the player came from the lobby and that the code belongs to this server. Anyone else is sent back. The world's seed, privacy and sandbox flag come from the registry, never from teleport data.
4. While running, a world server refreshes its registry entry every 30 seconds and removes it when the server closes.

Teleports don't work in Studio. The lobby refuses to create or join, and a game playtest runs world `STUDIO` with a random seed.

## Place-specific UI

Each place shows two ScreenGuis:

- **Core `App`**, mounted by `core/Interface/client/UiController`. It holds the shared HUD and the loading screen.
- **The place's app**, mounted by `<place>/<Place>Ui/client/<Place>UiController`: `LobbyApp` or `GameApp`.

Features keep their components in `<Feature>/client/components/`, and those components take sources and callbacks as props. The place's app (`lobby-app.tsx`, `game-app.tsx`) wires the components to atoms and messages. Stories sit next to the place's storybook in `<Place>Ui/client/stories/`.

## Adding a place

1. Create `src/<place>/` with a `<Place>Ui` feature (copy `src/lobby/LobbyUi`).
2. Copy `places/lobby/.rogen.json` and `assets/` to `places/<place>/`. Then update `"../../src/lobby"` and `"name"`. The scripts and CI find places from this file.
3. Add the place to both environments in `core/Teleport/shared/environments.ts`, and to the fallback in `places.ts`.

## Conventions

- **A place imports from `core` and from itself only.** The editor allows other imports, but the place build fails.
- **Don't reuse core names.** Rogen merges same-named feature folders, and files with the same name collide. Name UI features after their place (`GameUi`, not `Interface`).
- **Message ids.** Every Tether emitter shares one RemoteEvent and tags each message with an id from 0 to 255. Ids must be unique within a place. Core uses the low numbers, and place emitters start at 100, each in its own block of 10. The lobby and game never run together, so their ids may overlap.
- **Places spawn characters themselves.** `CharacterAutoLoads` is off, so players spawn only once their data has loaded.
- **Singletons are found by file name.** Only `*Service`, `*Controller` and `*Component` files are loaded. A module with any other name runs only when something imports it.
- **Avoid Roblox service names in file names.** Rogen reads names like `fooServer` as routing hints. A `.verbatim` file turns this off for a folder, as in the Cmdr `commands/` folders.
- **Cmdr command definitions** (`commands/foo.ts`) are moved to ReplicatedStorage, so they may only use `import type`. Their logic goes in `fooServer.ts`.
- **Never mutate state.** Atoms and player data always get new tables.
- **Logging.** Constructors receive an injected `Logger`. Debug logs show only in development builds.
- **Studio data** uses ProfileStore's mock store. To test real saves, change `USE_MOCK_STORE` in `DataService.ts`.

## Notes

- Never run a bare `rbxtsc` from the root. Use `pnpm build`, `pnpm watch` or `pnpm dev`.
- If you delete `flamework.build`, also delete every `places/*/out`, or Flamework will refuse to build because of the stale `tsbuildinfo`.
- `pnpm-workspace.yaml` hoists `node_modules`, which Argon and Rojo need, and pins transformers to roblox-ts's TypeScript.
- `argon.toml` turns off Argon's project detection, so it doesn't start a second `rbxtsc`.
