import js from "@eslint/js";
import tseslint from "typescript-eslint";
import robloxTs from "eslint-plugin-roblox-ts";
import prettier from "eslint-plugin-prettier/recommended";

export default tseslint.config(
	{ ignores: ["places","node_modules", "*.mjs"] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	robloxTs.configs.recommended,
	prettier,
);
