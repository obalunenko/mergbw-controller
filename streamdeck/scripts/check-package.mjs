import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const kinds = ["on", "off", "color", "brightness", "preset"];
const runtimeName = "com.obalunenko.mergbw.sdPlugin";
const licenses = ["elgato-streamdeck", "elgato-schemas", "elgato-utils", "ws", "zod", "tslib"];
const required = [
	"LICENSE",
	"manifest.json",
	"bin/plugin.js",
	"bin/package.json",
	"ui/index.html",
	"ui/inspector.css",
	"ui/inspector.js",
	"ui/vendor/sdpi-components.js",
	"ui/vendor/LICENSE",
	"ui/vendor/README.md",
	...["plugin", ...kinds].flatMap((kind) => [`imgs/${kind}.png`, `imgs/${kind}@2x.png`]),
	...licenses.map((name) => `licenses/${name}.txt`),
];
const ignoreRules = [
	"logs/",
	"*.log",
	"*.map",
	"settings.json",
	"presets.json",
	"streamdeck-buttons.txt",
	".env",
	"node_modules/",
	".test-build/",
	"tests/",
	"src/",
	"scripts/",
	"fixtures/",
	"*.streamDeckProfile",
	".DS_Store",
];
const fail = (message) => {
	throw new Error(`Package check: ${message}`);
};
const excluded = (path) =>
	path
		.split("/")
		.some(
			(part) =>
				["logs", "node_modules", ".test-build", "tests", "src", "scripts", "fixtures"].includes(part) ||
				["settings.json", "presets.json", "streamdeck-buttons.txt", ".env", ".DS_Store"].includes(part) ||
				/\.(log|map|streamDeckProfile)$/.test(part),
		);

export function validateEntries(entries) {
	const files = [];
	for (const entry of entries) {
		if (entry.includes("\\") || entry.split("/").includes("..") || !entry.startsWith(`${runtimeName}/`))
			fail("unexpected archive path");
		if (entry.endsWith("/")) continue;
		const path = entry.slice(runtimeName.length + 1);
		if (!required.includes(path)) fail(`unexpected distribution file: ${path}`);
		files.push(path);
	}
	if (new Set(files).size !== files.length) fail("duplicate archive entry");
	for (const path of required) if (!files.includes(path)) fail(`missing distribution file: ${path}`);
	return files;
}
export function checkRuntime(directory) {
	const text = (path) => readFileSync(join(directory, path), "utf8");
	const manifest = JSON.parse(text("manifest.json"));
	if (
		manifest.UUID !== "com.obalunenko.mergbw" ||
		manifest.Version !== "0.1.0.0" ||
		manifest.SDKVersion !== 3 ||
		manifest.Nodejs?.Version !== "24" ||
		manifest.Software?.MinimumVersion !== "7.1" ||
		JSON.stringify(manifest.OS) !== JSON.stringify([{ Platform: "mac", MinimumVersion: "13.5" }])
	)
		fail("manifest identity or supported versions");
	if (
		manifest.CodePath !== "bin/plugin.js" ||
		manifest.PropertyInspectorPath !== "ui/index.html" ||
		manifest.Icon !== "imgs/plugin" ||
		manifest.CategoryIcon !== "imgs/plugin"
	)
		fail("manifest runtime paths");
	if (!Array.isArray(manifest.Actions) || manifest.Actions.length !== 5) fail("expected five actions");
	const ids = new Set();
	for (const action of manifest.Actions) {
		const kind = action.UUID?.replace("com.obalunenko.mergbw.", "");
		if (!kinds.includes(kind) || ids.has(kind)) fail("action UUIDs");
		ids.add(kind);
		if (
			action.Icon !== `imgs/${kind}` ||
			JSON.stringify(action.Controllers) !== '["Keypad"]' ||
			action.SupportedInMultiActions !== false ||
			action.DisableAutomaticStates !== true ||
			action.States?.length !== 1 ||
			action.States[0].Image !== `imgs/${kind}` ||
			(action.PropertyInspectorPath && action.PropertyInspectorPath !== "ui/index.html")
		)
			fail("action paths or behavior");
	}
	const rules = text(".sdignore")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
	if (
		rules.length !== ignoreRules.length ||
		rules.some((rule) => !ignoreRules.includes(rule)) ||
		ignoreRules.some((rule) => !rules.includes(rule))
	)
		fail("distribution ignore rules changed");
	const files = [];
	const walk = (path = "") => {
		for (const name of readdirSync(join(directory, path))) {
			const relative = path ? `${path}/${name}` : name;
			const stat = lstatSync(join(directory, relative));
			if (stat.isSymbolicLink()) fail("runtime symlink");
			if (excluded(relative)) continue;
			if (stat.isDirectory()) walk(relative);
			else if (relative !== ".sdignore") files.push(relative);
		}
	};
	walk();
	validateEntries(files.map((path) => `${runtimeName}/${path}`));
	const checksum = createHash("sha256")
		.update(readFileSync(join(directory, "ui/vendor/sdpi-components.js")))
		.digest("hex");
	if (
		!text("ui/vendor/README.md").includes(`SHA-256: \`${checksum}\``) ||
		!text("ui/vendor/README.md").includes("https://sdpi-components.dev/releases/v4/sdpi-components.js")
	)
		fail("vendor checksum/source");
	if (
		!text("ui/vendor/LICENSE").includes("Permission is hereby granted") ||
		!text("ui/vendor/LICENSE").includes("Redistribution and use")
	)
		fail("vendor licenses");
	for (const name of licenses)
		if (
			!text(`licenses/${name}.txt`).includes(
				name === "tslib" ? "Permission to use, copy, modify" : "Permission is hereby granted",
			)
		)
			fail("runtime license");
	for (const path of ["ui/index.html", "ui/inspector.css", "ui/inspector.js"]) {
		const source = text(path);
		if (
			/(?:src|href)\s*=\s*["']?(?:https?:)?\/\/|url\(\s*["']?(?:https?:)?\/\/|@import\s+["'](?:https?:)?\/\/|(?:fetch|importScripts)\s*\(\s*["']https?:\/\//i.test(
				source,
			)
		)
			fail("remote runtime asset");
	}
	if (JSON.parse(text("bin/package.json")).type !== "module") fail("runtime module metadata");
	for (const match of text("bin/plugin.js").matchAll(/^import\s+(?:.*?\s+from\s+)?["']([^"']+)["']/gm))
		if (!builtinModules.includes(match[1]) && !builtinModules.includes(match[1].replace(/^node:/, "")))
			fail("unbundled runtime dependency");
	return files.sort();
}
export function checkArchive(archive) {
	const listing = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" });
	return validateEntries(listing.trim().split(/\r?\n/));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const directory = fileURLToPath(new URL(`../${runtimeName}/`, import.meta.url));
		const files = checkRuntime(directory);
		if (process.argv[2] === "--archive") {
			if (!process.argv[3]) fail("archive argument missing");
			const entries = checkArchive(resolve(process.argv[3]));
			console.log(`Installer checked: ${entries.length} files (${basename(process.argv[3])}).`);
		} else if (process.argv[2]) fail("unknown argument");
		console.log(`Runtime checked: ${files.length} files, five actions, local assets and licenses.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : "Package check failed");
		process.exitCode = 1;
	}
}
