import { CreateVideStory } from "@rbxts/ui-labs";
import Vide from "@rbxts/vide";

import { MainMenu } from "lobby/Menu/client/components/main-menu";
import { CreatePage } from "lobby/Servers/client/components/create-page";

const controls = {};

export = CreateVideStory({ controls, vide: Vide }, () => (
	<MainMenu page={() => "create"} onPage={(page) => print(`page ${page}`)}>
		<CreatePage
			slot={1}
			onCreate={(settings, isPrivate) => print("create", settings, `private ${isPrivate}`)}
			onReturn={() => print("return")}
		/>
	</MainMenu>
));
