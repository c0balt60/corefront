# Syncback workflow

This page covers how to edit assets in Studio and get the changes into the repo. Read [rules.md](rules.md) first.

## Set up a session

1. Run `pnpm dev <place>`.
2. In Studio, open a new **Baseplate** place and connect the Argon plugin.
3. In the Argon plugin's settings, turn on **two-way sync**.
4. Check the connection: move the `SpawnLocation` slightly. `places/<place>/assets/Workspace/SpawnLocation/init.meta.json` should change. Undo the move afterwards.

Turn two-way sync off when you only want to write code, so stray clicks in Studio don't end up in your commits.

## Edit synced assets

Use this for small things: spawn points, markers, a few props.

1. Build or edit inside `Workspace`, `ServerStorage.Assets` or `ReplicatedStorage.Assets`.
2. Argon writes each change to `assets/` as you make it. If a large change trips Argon's safety limit, it asks you to confirm first.
3. Review the changes with `git status` and `git diff places/<place>/assets`.
4. Commit.

## Add or update a packed model

Use this for big things: a full map or a detailed model.

1. Build the model in Studio, inside one of the synced locations.
2. Right-click it and choose **Save to File** in `.rbxm` format.
3. Save it in the matching `assets/` folder and name it after the model. For example, save the lobby map as `places/lobby/assets/Workspace/Map.rbxm`. The file name becomes the instance name.
4. If you built the model as synced instances first, delete that model's folder from `assets/`. Otherwise the place will contain two copies.
5. Run `pnpm build <place>` to check the file loads.
6. Commit. Git LFS stores the `.rbxm` file for you, because of `.gitattributes`.

To update a packed model, edit it in Studio, then repeat steps 2 and 3, saving over the existing file. Until you do, Studio edits to a packed model stay only in Studio. Argon never writes to `.rbxm` files.

## Undo changes

- **Throw away uncommitted asset edits:** run `git restore places/<place>/assets`. Argon pushes the restored files back into Studio.
- **Studio and the repo are out of sync:** disconnect, open a fresh Baseplate place, and reconnect. The repo wins.

## Before you open a pull request

- [ ] `pnpm build` passes. A broken asset file fails the build.
- [ ] `git diff` shows only the asset changes you meant to make.
- [ ] New `.rbxm` files appear in `git lfs ls-files`.
- [ ] Code that clones an asset you renamed or moved has been updated.

CI rebuilds every place from the repo on each pull request. When the PR merges, staging gets exactly what's in `assets/`.
