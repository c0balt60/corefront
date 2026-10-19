# Gameplay

The rules, content and controls as they are in the code. Balance values live in `src/game/Base/shared/` and `src/game/Base/server/WaveService.ts`. Check those files before trusting a number here.

## Worlds

- **Creating a world** (lobby, DEPLOY > CREATE): pick a seed or press RANDOM, then optionally turn on PRIVATE WORLD or SANDBOX WORLD. Each world is a reserved server with up to 4 players. Its 6-character join code is listed in the MemoryStore `Worlds` registry.
- **Joining**: pick from the public worlds list (fullest first), or use JOIN BY CODE.
- **Star system** (`core/Worlds/shared/star-system.ts`): the seed decides the star name and its 4–7 planets. Planet 0 is always Habitable at difficulty 0.
    - Planet kinds: Habitable, Barren, Frozen, Volcanic.
    - Each planet rates difficulty, aliens and resources from 0 to 4: Minimal, Low, Medium, High, Extreme.

## A planet

- The Core (1500 HP) lands at the centre of a 1024-stud map. The team starts with 80 copper and 40 lead.
- Mine ore by holding the mouse on a deposit, then drop it off at the Core. Deposits never run out.
- Buildings must be within 160 studs of you. Removing a building refunds half its cost.
- **Waves**: there's a 90-second grace period, then a wave every 60 seconds. Any player can call the next wave early.
    - A planet has 5 + 2 × difficulty waves. Alien health scales with difficulty and with the aliens rating.
    - Aliens land in drop zones, where nothing can be built. A landing kills anyone standing in one. Medium and harder planets have two drop zones.
- **Win**: clear every wave. The planet is liberated and the next one unlocks.
- **Lose**: the Core is destroyed. After 8 seconds the team retreats to the nearest liberated planet, and the lost base is gone.
- **Travel** (star map, M): from a liberated planet, propose a launch to an unlocked planet. A launch costs fuel and can carry cargo, and every deployed player must ready up. Liberated bases stay in memory while the team is away.

## Content

**Resources**

- Mined: copper, lead, coal, sand, titanium, scrap, thorium.
- Crafted: graphite, silicon, metaglass, pyratite.
- Ores by planet kind: Habitable cu/pb/coal/sand, Barren cu/pb/scrap/ti/sand, Frozen cu/pb/ti, Volcanic cu/pb/coal/thorium.

**Buildings** (`Base/shared/buildings.ts`). Only Drill and Conveyor are unlocked at the start. Research unlocks the rest.

| Category     | Buildings                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Production   | Drill, Adv. Drill, Laser Drill                                                                                             |
| Distribution | Conveyor, Ti Conveyor, Router, Sorter, Junction, Container, Vault, Unloader, Source (sandbox only)                         |
| Crafting     | Graphite Press, Si Smelter, Kiln, Pulverizer, Pyratite Mixer                                                               |
| Power        | Combustion Gen., Solar Panel, RTG Generator, Battery, Large Battery, Power Node, Large Node                                |
| Turrets      | Turret, Auto-Turret, Scorch, Arc, Hail, Scatter, Vulcan, Fuse, Salvo, Cannon, Swarmer, Ripple, Reaper, Harbinger, Meltdown |
| Defense      | Wall, Ti Wall, Mender                                                                                                      |

**Aliens** (`WaveService.ts`). Tougher kinds join as the waves go on, and the last wave adds a Titan and a Dreadnought.

- Ground: crawler, sapper, brute, spitter, mortar, shielder, strider, aegis, hydra, fortress, titan.
- Air: drone, wasp, hornet, bomber, gunship, carrier, frigate, dreadnought.

**Research** (T, `Research/shared/research.ts`): 48 nodes. Each level costs 1.75× the one before.

- Some nodes stay hidden until the Core has held a certain resource.
- Some need 1–3 liberated planets.
- Upgrades cover carry capacity, walk speed, blaster damage and cooldown, Core health and capacity, building health, turret damage and drill yield.
- Research isn't saved. It lasts for the life of the world server.

**Sandbox**: a single planet with everything researched, no waves and a Core that can't die. A panel spawns or clears aliens.

## Controls

| Input                     | Action                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| 1–9                       | Hotbar (Blaster, Build)                                                                    |
| LMB                       | Blaster: fire. Build: place, or drag a line. No tool: mine ore, or open a building's panel |
| Double-click building     | Transfer items                                                                             |
| R / Q / F                 | Rotate / pick a building / remove mode                                                     |
| Shift                     | Sprint                                                                                     |
| G, middle mouse, D-pad up | Ping: reveals every alien                                                                  |
| M                         | Star map (WASD pans, Q/E rotate, R resets)                                                 |
| T                         | Research tree                                                                              |
| F4                        | Terrain debug panel (trusted players only)                                                 |
| F2                        | Cmdr admin console                                                                         |

## Admin commands

The console opens for everyone in Studio. On live servers, only the place creator and `ADMIN_USER_IDS` in `core/Admin/server/CmdrService.ts` can open it.

| Command                                | Effect                         |
| -------------------------------------- | ------------------------------ |
| `coins <player> <amount>`              | Gives coins (saved data)       |
| `giveinv <player> <resource> <amount>` | Adds to a player's pack        |
| `giveresource <resource> <amount>`     | Adds to the Core               |
| `nextwave` / `setwave <n>`             | Skips ahead in the waves       |
| `spawnaliens <kind> <count> [player]`  | Spawns aliens                  |
| `winplanet` / `loseplanet`             | Ends the current planet        |
| `sandbox`                              | Turns this server into sandbox |

## Saved data

Only `coins` and `matchesPlayed` (`core/Data/shared/player-data.ts`) are saved, in ProfileStore. Planets, bases, the Core's contents and research are all in memory, so they're gone when the world server shuts down.
