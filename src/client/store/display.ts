import { atom } from "@rbxts/charm";

export type Screens = "in-game" | "loading-screen" | "main-menu";

export const displayAtom = atom<Screens>("loading-screen");
