import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const runtime =
	process.env.MERGBW_PLUGIN_STAGE === "1"
		? "../dist/plugin-stage/com.obalunenko.mergbw.sdPlugin"
		: "com.obalunenko.mergbw.sdPlugin";
export default [
	{
		input: "src/plugin.ts",
		output: { file: `${runtime}/bin/plugin.js`, format: "es", sourcemap: false },
		plugins: [
			nodeResolve({ preferBuiltins: true }),
			commonjs(),
			typescript({ tsconfig: "./tsconfig.json" }),
			{
				name: "runtime-module",
				generateBundle() {
					this.emitFile({ type: "asset", fileName: "package.json", source: '{"type":"module"}' });
				},
			},
		],
		external: [/^node:/],
	},
	{
		input: "src/ui/inspector.ts",
		output: { file: `${runtime}/ui/inspector.js`, format: "iife", sourcemap: false },
		plugins: [typescript({ tsconfig: "./tsconfig.ui.json" })],
	},
];
