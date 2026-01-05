import { RunService } from "@rbxts/services";

export const GAME_NAME = "Mindustry Clone";

export const IS_EDIT = RunService.IsStudio() && !RunService.IsRunning();
export const IS_SERVER = RunService.IsServer();
