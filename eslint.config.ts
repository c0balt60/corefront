import isentinel from "@isentinel/eslint-config";

export default isentinel({
	name: "project/base",
	flawless: true,
	perfectionist: {
		customClassGroups: [
			"onInit",
			"onStart",
			"onPlayerJoin",
			"onPlayerLeave",
			"onRender",
			"onPhysics",
			"onTick",
		],

		sortObjects: {
			customGroups: {
				id: "^id$",
				name: "^name$",
				callbacks: ["\b(on[A-Z][a-zA-Z]*)\b"],
				reactProps: ["^children$", "^ref$"],
				reflex: ["^loadPlayerData$", "^closePlayerData$"],
			},
			groups: ["id", "name", "reflex", "unknown", "reactProps", "callbacks"],
		},
	},
	pnpm: true,
	react: true,
	rules: {
		"@cspell/spellchecker": [
			"warn",
			{
				autoFix: true,
				cspell: {
					allowCompoundWords: true,
					enabled: true,
				},

				customWordListFile: "cspell.config.yaml",
				generateSuggestions: true,
				numSuggestions: 100,
			},
		],
		"comment-length/limit-single-line-comments": ["off"],
		"flawless/naming-convention": [
			"off",
			{
				format: ["StrictPascalCase"],
				selector: ["variable"],
			},
		],
		"jsdoc/require-description-complete-sentence": ["off"],
	},
	spellCheck: true,
	type: "game",
});
