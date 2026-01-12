import { atom } from "@rbxts/charm";

interface Transition {
	delay: number;
	type: "idle" | "in" | "out";
}

export const transitionAtom = atom<Transition>({
	delay: 0,
	type: "in",
});
