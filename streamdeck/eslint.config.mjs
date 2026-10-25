import { config } from "@elgato/eslint-config";

export default [
	...config.recommended,
	{
		rules: {
			// Keep useful diagnostics without requiring filler comments or alphabetic class layout.
			"jsdoc/require-jsdoc": "off",
			"@typescript-eslint/member-ordering": "off",
		},
	},
];
