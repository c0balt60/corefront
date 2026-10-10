import js from "@eslint/js";
import tseslint from "typescript-eslint";
import robloxTs from "eslint-plugin-roblox-ts";
import prettier from "eslint-plugin-prettier/recommended";

export default tseslint.config(
	{ ignores: ["places","node_modules", "*.mjs"] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	robloxTs.configs.recommended,
	{
		rules: {
			// Vide's <Show> children return $tuple(element, exitDelay) as two Lua values.
			// The rule's autofix turns that into an array, which silently drops the delay.
			"roblox-ts/no-user-defined-lua-tuple": ["error", { allowTupleMacro: true }],
		},
	},
	prettier,
);
