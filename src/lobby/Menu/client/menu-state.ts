import { atom } from "@rbxts/charm";

export type MenuPage = "home" | "deploy" | "saves" | "create" | "join" | "store" | "settings" | "changelog";

/** Whether the full-screen menu is showing. `MenuController` keeps it in step with the topbar button. */
export const menuOpenAtom = atom(true);

/** The page the menu is on. Opening the menu always starts at "home". */
export const menuPageAtom = atom<MenuPage>("home");
