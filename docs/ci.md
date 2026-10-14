# CI/CD

`.github/workflows/ci.yml` runs on GitHub Actions:

| Trigger        | What it does                                                            |
| -------------- | ----------------------------------------------------------------------- |
| Pull request   | Lint and build every place, and upload the `.rbxl` files as an artifact |
| Push to `dev`  | Same, then publish every place to **testing**                           |
| Push to `main` | Same, then publish every place to **production**                        |

Publishing runs `node scripts/publish.mjs <environment>`. The script reads `ENVIRONMENTS` from `src/core/Teleport/shared/environments.ts` and runs `rbxcloud experience publish` for each place. If a place is locked by Team Create, Roblox answers 409, so the script retries twice, waiting 60 seconds each time. Close Studio before you push.

To publish by hand: run `pnpm build`, put `RBXCLOUD_API_KEY=...` in `.env` (see `.example.env`), then run `node --env-file=.env scripts/publish.mjs testing`.

## Setup

1. Make two experiences, testing and production. Each needs a lobby place (as the start place) and a game place.
2. Put their universe and place ids in `environments.ts`. The ids aren't secret. Publishing fails while any id is 0.
3. Create an Open Cloud API key in the [Creator Dashboard](https://create.roblox.com/dashboard/credentials). Give it **universe-places** write access for both experiences, and allow any IP, because GitHub runners don't have fixed addresses.
4. In GitHub > Settings > Environments, create `testing` and `production`, and add the key to each as the secret `RBXCLOUD_API_KEY`. Never commit the key.
5. Optional: protect `production` with required reviewers.
