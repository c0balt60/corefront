# Syncback rules

Syncback writes what you build in Studio back into the repo, so that the repo, not a place file, stays the source of truth. These rules keep that true. For the step-by-step process, see [workflow.md](workflow.md).

## What syncs where

Each place has its own `assets/` folder:

| In Studio                  | On disk                                   |
| -------------------------- | ----------------------------------------- |
| `Workspace`                | `places/<place>/assets/Workspace`         |
| `ServerStorage.Assets`     | `places/<place>/assets/ServerStorage`     |
| `ReplicatedStorage.Assets` | `places/<place>/assets/ReplicatedStorage` |

Anything outside these three is **not** synced back. Edits you make there in Studio are lost the next time the place is built. To sync another service, add it to the `tree` in that place's `.rogen.json`, for example `"Lighting": { "$path": "assets/Lighting" }`.

The rules live in each place's `.rogen.json`, under `project.syncback`:

| Rule                              | Effect                            |
| --------------------------------- | --------------------------------- |
| `ignoreGlobs: out/**, include/**` | Studio never writes compiled code |
| `ignoreGlobs: assets/**/*.rbxm`   | Studio never writes packed models |
| `ignoreClasses: Camera, Terrain`  | Never synced                      |

## Rules

1. **Code lives in `src`, never in Studio.** Don't create or edit scripts in Studio. Script edits under `ServerScriptService` or `StarterPlayer` are ignored, and the compiler overwrites them. Scripts inside an asset would be synced back as `.luau` files outside the TypeScript build, so keep all logic in a feature and give assets tags or attributes for that code to read.
2. **Never edit packages in Studio.** `ReplicatedStorage.rbxts_include.node_modules` maps to `../../node_modules`. Argon can't filter that path, because it sits outside the place folder.
3. **Pick the right storage for each asset:**

    | Store as                                   | Use for                                                                                  | How it's saved                          |
    | ------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------- |
    | **Synced** (folders with `init.meta.json`) | Small things you edit often: spawn points, markers, triggers, a few props, lighting rigs | Automatically, while two-way sync is on |
    | **Packed** (`.rbxm`)                       | Large things: a full map, detailed models, anything with hundreds of parts or more       | By hand, with _Save to File_            |

    Rough rule of thumb: if a model is more than about 100 instances, pack it. Synced storage writes one folder per instance, which gets slow and noisy at scale.

4. **Give siblings unique names.** Argon names files after instances, so two children called `Part` can't both be saved. Duplicates are skipped. Characters that aren't valid in file names are renamed.
5. **Put anything code clones in an `Assets` folder.** Models that code spawns go in `ServerStorage.Assets` (server only) or `ReplicatedStorage.Assets` (clients too), never loose in `Workspace`. Code finds them by name, so renaming one is a code change too.
6. **Only one person edits a packed model at a time.** `.rbxm` files are binary, and Git can't merge them. Agree who owns a model before you change it. Use [LFS locking](https://github.com/git-lfs/git-lfs/wiki/File-Locking) (`git lfs lock <file>`) if your team wants that enforced.
7. **Review every asset diff before committing.** Synced changes show up as `init.meta.json` diffs. Make sure you meant to change each one. Studio sometimes changes properties you never touched, such as when you nudge a part.
8. **Never commit place files.** `.rbxl` and `.rbxlx` files are build output and are already ignored by git. The only Studio files that belong in the repo are under `assets/`.
9. **Terrain isn't synced.** If a place needs terrain, generate it from code or bring it up with the team first.
10. **A broken asset fails the build.** `pnpm build` and CI stop when the build tool can't read an asset file. Fix or revert the file. Never work around it.
