import { LocalPlayer } from "./local-player";

// eslint-disable-next-line flawless/naming-convention, ts/no-non-null-assertion -- Should be present during usage.
export const PlayerGui = LocalPlayer.FindFirstChildWhichIsA("PlayerGui")!;
