# Quickstart

This page takes you from a fresh computer to a running lobby in Studio.

## 1. Install the tools

| Tool                                                          | Why                                                                                              | Install                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| [Git](https://git-scm.com) and [Git LFS](https://git-lfs.com) | Source control. LFS stores packed `.rbxm` models.                                                | Install both, then run `git lfs install` once per computer. |
| [Node.js](https://nodejs.org) 22.18 or newer (LTS)            | Runs the compiler and the build scripts. `scripts/publish.mjs` needs 22.18+ to load `.ts` files. | Installer from nodejs.org                                   |
| [pnpm](https://pnpm.io)                                       | Package manager. The version is pinned in `package.json`.                                        | `corepack enable`, which ships with Node                    |
| [Rokit](https://github.com/rojo-rbx/rokit)                    | Installs the pinned Argon, Rojo and rbxcloud versions from `rokit.toml`.                         | Follow the Rokit README                                     |
| [Roblox Studio](https://create.roblox.com)                    | Running and editing places                                                                       | Roblox installer                                            |
| [VS Code](https://code.visualstudio.com)                      | Recommended editor. The repo suggests the roblox-ts and ESLint extensions.                       | Accept the prompt when you open the folder                  |

## 2. Set up the repo

```console
git clone https://github.com/c0balt60/rogen-multiplace.git
cd rogen-multiplace
git lfs pull
rokit install
pnpm install
```

- `rokit install` installs `argon`, `rojo` and `rbxcloud`.
- Argon installs its Studio plugin the first time it runs. If the plugin doesn't appear in Studio, run `argon plugin install`.

Check that everything works:

```console
pnpm build
```

The build should finish with `places/lobby/lobby.rbxl` and `places/match/match.rbxl`.

## 3. Run a place

```console
pnpm dev lobby
```

This command:

1. Compiles the lobby.
2. Watches for changes.
3. Starts a sync server with the `serve` tool from `tooling.json`, which is Argon by default. The terminal prints the port: usually 8000 for Argon, 34872 for Rojo.

In Studio:

1. Open a new **Baseplate** place.
2. Open the plugin for the serve tool (Argon by default) and click **Connect**.
3. Press **Play**.

The Studio session stays in sync with the code: when you save a `.ts` file, it recompiles and syncs automatically.

To work on the match instead, stop the lobby with `Ctrl+C` and run `pnpm dev match`. Only run one place's `dev` or `watch` at a time. Both places share `flamework.build`, and two compilers running at once can overwrite each other's changes to it.

## Commands

`<place>` is any folder in `places/`: `lobby` or `match`.

| Command                                            | What it does                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm dev <place>`                                 | Compile, watch, and serve to Studio                                                                  |
| `pnpm watch <place>`                               | Compile and watch, with no sync server                                                               |
| `pnpm serve <place>`                               | Sync server only                                                                                     |
| `pnpm build <place>`                               | Build one place once, into `places/<place>/<place>.rbxl`                                             |
| `pnpm build <place> --open`                        | Build, then open the place file in Studio                                                            |
| `pnpm build`                                       | Build every place                                                                                    |
| `pnpm lint` / `pnpm lint:fix`                      | ESLint and Prettier                                                                                  |
| `node --env-file=.env scripts/publish.mjs staging` | Publish the built places by hand. Needs `RBXCLOUD_API_KEY` in `.env`. CI normally does this for you. |

## Choosing build and serve tools

`tooling.json` sets which tool runs each step, for everyone and in CI:

```json
{
	"build": "rojo",
	"serve": "argon"
}
```

| Step    | Used by                  | Options                   |
| ------- | ------------------------ | ------------------------- |
| `build` | `pnpm build`, CI         | `rojo` (default), `argon` |
| `serve` | `pnpm dev`, `pnpm serve` | `argon` (default), `rojo` |

Rojo is the default for builds because Argon can't read some `.rbxm` files that Studio saves. To try the other tool for one run without changing the file, set `BUILD_TOOL` or `SERVE_TOOL`:

```console
# bash
SERVE_TOOL=rojo pnpm dev lobby
# PowerShell
$env:SERVE_TOOL = "rojo"; pnpm dev lobby; Remove-Item Env:SERVE_TOOL
```

Rojo can't read Argon's `syncback` rules, so when Rojo runs, `scripts/place.mjs` gives it `places/<place>/rojo.project.json`, a copy without them. While serving, that copy is updated whenever Rogen regenerates the project. Two-way sync (see [syncback](syncback/workflow.md)) needs Argon as the serve tool.

## In-game helpers

- **F2** opens the Cmdr admin console. Try `coins . 100`.
- In Studio, player data uses a mock store, so playtests never touch live data.
- Teleports don't run in Studio. A lobby playtest logs what it would have sent. A match playtest runs a Practice round on its own.

## Troubleshooting

| Problem                                                       | Fix                                                                                             |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Argon picked a different port                                 | Argon moves to the next free port when 8000 is busy. Connect to the port shown in the terminal. |
| Argon fails with `Failed to read RbxmModel ... Type mismatch` | Argon can't read that `.rbxm`. Serve with Rojo (`SERVE_TOOL=rojo`).                             |
| `Could not find Rojo data ... no $path covers ...`            | The project file is older than a newly added file. Run `pnpm build <place>` again.              |
| Flamework refuses to build, mentioning `tsbuildinfo`          | Delete `flamework.build` and every `places/*/out`, then rebuild.                                |
| `.rbxm` files are tiny text files                             | LFS wasn't set up when you cloned. Run `git lfs install` and then `git lfs pull`.               |

## Next

- [Create a feature](features/create-new.md)
- [Syncback rules](syncback/rules.md) and [syncback workflow](syncback/workflow.md)
