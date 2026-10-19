# Corefront

A solo/co-op factory tower defense for Roblox, up to 4 players. Every world generates from a seed into its own star system of 4–7 planets, and you / your team frees them one at a time.

On each planet your Core lands in the middle of a procedurally generated map. You mine ore by hand to get started, then build drills, conveyor lines, crafters and power grids to feed a growing ring of turrets. After a short grace period, alien waves land in drop zones. Walkers path through your walls and fliers go straight for the Core. Survive every wave to **liberate** the planet and unlock the next one. If the Core falls, the team retreats to the nearest liberated planet and loses that base.

Between fights, spend resources in the research tree on new buildings, turrets and player upgrades. Then fuel a launch to a harder planet: Habitable, Barren, Frozen or Volcanic, each with its own biomes, ores and alien mix. Worlds can be public, private (join by code) or sandbox.

See [docs/gameplay.md](docs/gameplay.md) for buildings, aliens, controls and admin commands.

## Stack

[roblox-ts](https://roblox-ts.com), [Flamework](https://flamework.fireboltofdeath.dev) and [Rogen](https://rogen-playfully.vercel.app/docs/v1/setups/multi-place) for a multi-place setup: `src/core` is shared, and `src/<place>` is built into each place's own Rojo project.

| Area       | Packages                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Framework  | `@flamework/core`, `@flamework/components`                                                                         |
| State      | `@rbxts/charm`, `@rbxts/charm-sync`                                                                                |
| Data       | `@rbxts/profile-store`, MemoryStore (world registry)                                                               |
| Networking | `@rbxts/tether` (with `@rbxts/serio`)                                                                              |
| UI         | `@rbxts/vide`, `@rbxts/vide-charm`, `@rbxts/ripple` / `@rbxts/vide-ripple`, `@rbxts/ui-labs`, `@rbxts/topbar-plus` |
| Utilities  | `@rbxts/validate-tree`, `@rbxts/janitor`, `@rbxts/sift`, `@rbxts/t`, `@rbxts/log`, `@rbxts/cmdr`                   |

## Requirements

- [Node.js](https://nodejs.org) 22.18+ and [pnpm](https://pnpm.io)
- [Rokit](https://github.com/rojo-rbx/rokit). `rokit install` installs [Argon](https://argon.wiki), [Rojo](https://rojo.space) and [rbxcloud](https://github.com/Sleitnick/rbxcloud). You also need the Studio plugin for your serve tool (see `tooling.json`).
- [Git LFS](https://git-lfs.com). Run `git lfs install` once, so packed `.rbxm` models are stored in LFS.

## Getting started

```console
git lfs pull
rokit install
pnpm install
pnpm dev lobby
```

Next, open a Baseplate in Studio, connect the Argon plugin and press Play. To work on gameplay, run `pnpm dev game` instead. The full walkthrough and troubleshooting are in [docs/quickstart.md](docs/quickstart.md).

## Scripts

Each command takes a place name, meaning any folder in `places/`: `lobby` or `game`.

| Script                        | What it does                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev <place>`            | Runs `watch` and `serve` together                                               |
| `pnpm watch <place>`          | Regenerates the project with Rogen and recompiles with `rbxtsc` on every change |
| `pnpm serve <place>`          | Serves the place to Studio with the `serve` tool from `tooling.json`            |
| `pnpm build [place...]`       | Builds the given places (or all of them) into `places/<place>/<place>.rbxl`     |
| `pnpm build <place> --open`   | Builds, then opens the place in Studio                                          |
| `pnpm lint` / `pnpm lint:fix` | ESLint and Prettier                                                             |

Run only one place's `dev` or `watch` at a time. All places share `flamework.build`, so two running compilers can overwrite each other.

## Project layout

```
src/
  core/        Shared by both places: Data, Interface, Admin, Character, Teleport, Worlds
  lobby/       Main menu, world create/join (Servers), Loading
  game/        Arrival, Base (buildings, waves, power, belts), Planets, Research, Terrain, GameUi
places/<place>/
  .rogen.json  Sources and Rojo tree for the place
  assets/      Studio-made content, synced by Argon
scripts/       place.mjs (build/watch/serve/dev), publish.mjs (rbxcloud)
docs/          Guides, see below
```

## Docs

- [Quickstart](docs/quickstart.md): tools, first run, troubleshooting
- [Gameplay](docs/gameplay.md): game rules, content lists, controls, admin commands
- [Architecture](docs/architecture.md): how places are built, lobby to game flow, UI, conventions
- [Creating a feature](docs/features/create-new.md)
- [Syncback rules](docs/syncback/rules.md) and [workflow](docs/syncback/workflow.md)
- [CI/CD](docs/ci.md)
