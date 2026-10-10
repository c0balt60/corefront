import { Choose, CreateVideStory, type InferVideProps } from "@rbxts/ui-labs";
import Vide, { effect, source } from "@rbxts/vide";

import { MainMenu } from "lobby/Menu/client/components/main-menu";
import type { MenuPage } from "lobby/Menu/client/menu-state";

const controls = {
	page: Choose<MenuPage>(["home", "deploy", "store", "settings", "changelog"]),
};

export = CreateVideStory({ controls, vide: Vide }, (props: InferVideProps<typeof controls>) => {
	// The control picks the page, and clicking around the menu moves it from there.
	const page = source<MenuPage>(props.controls.page());
	effect(() => page(props.controls.page()));

	return <MainMenu page={page} onPage={page} />;
});
