import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { nativeFiles, validateNativePayload } from "../native/payload-validator.mjs";

const kinds = ["on", "off", "color", "brightness", "preset", "scene", "transition"];
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
	"**/settings.json",
	"**/presets.json",
	"**/streamdeck-buttons.txt",
	"**/.env*",
	"**/*.log",
	"**/logs/**",
	"**/fixtures/**",
	"*.go",
	"*.ts",
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

const releaseTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const nativeRequired = [
	"release.json",
	"controller/payload-manifest.json",
	"licenses/go-native-notices.txt",
	...nativeFiles.map((path) => `controller/${path}`),
];
function expectedFiles(options) {
	if (options.softwareOnly) return required;
	return [
		...required,
		...nativeRequired,
		...(options.packageMode === "distribution" ? ["controller/MeRGBW Controller.app/Contents/CodeResources"] : []),
	];
}
export function validateEntries(entries, options = {}) {
	const expected = expectedFiles(options);
	if (new Set(entries).size !== entries.length) fail("duplicate archive entry");
	const files = [];
	for (const entry of entries) {
		if (
			entry.includes("\\") ||
			entry
				.split("/")
				.some((part, index) => part === ".." || part === "." || (!part && index !== entry.split("/").length - 1)) ||
			!entry.startsWith(`${runtimeName}/`)
		)
			fail("unexpected archive path");
		if (entry.endsWith("/")) {
			if (entry !== `${runtimeName}/` && !expected.some((path) => `${runtimeName}/${path}`.startsWith(entry)))
				fail("unexpected archive directory");
			continue;
		}
		const path = entry.slice(runtimeName.length + 1);
		if (!expected.includes(path)) fail(`unexpected distribution file: ${path}`);
		files.push(path);
	}
	if (new Set(files).size !== files.length) fail("duplicate archive entry");
	for (const path of expected) if (!files.includes(path)) fail(`missing distribution file: ${path}`);
	return files;
}
export function checkRuntime(directory, options = {}) {
	if (lstatSync(directory).isSymbolicLink()) fail("runtime symlink");
	if (!options.softwareOnly) checkPayload(directory, options);
	const text = (path) => readFileSync(join(directory, path), "utf8");
	if (!options.softwareOnly && options.sourceDirectory) {
		for (const path of required) {
			const staged = readFileSync(join(directory, path));
			const source = readFileSync(join(options.sourceDirectory, path));
			if (path === "manifest.json") {
				const normalize = (bytes) => {
					const value = JSON.parse(bytes.toString("utf8"));
					delete value.Version; // Stamped from release.json at assembly.
					if (value.Nodejs) delete value.Nodejs.Debug;
					return JSON.stringify(value);
				};
				if (normalize(staged) !== normalize(source)) fail("staged runtime differs from current built source");
			} else if (!staged.equals(source)) fail("staged runtime differs from current built source");
		}
	}

	const manifest = JSON.parse(text("manifest.json"));
	if (
		manifest.UUID !== "com.obalunenko.mergbw" ||
		typeof manifest.Version !== "string" ||
		!/^\d+\.\d+\.\d+\.\d+$/.test(manifest.Version) ||
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
	if (!Array.isArray(manifest.Actions) || manifest.Actions.length !== 7) fail("expected seven actions");
	const ids = new Set();
	for (const action of manifest.Actions) {
		const kind = action.UUID?.replace("com.obalunenko.mergbw.", "");
		if (!kinds.includes(kind) || ids.has(kind)) fail("action UUIDs");
		ids.add(kind);
		if (
			action.Icon !== `imgs/${kind}` ||
			JSON.stringify(action.Controllers) !== (kind === "brightness" ? '["Keypad","Encoder"]' : '["Keypad"]') ||
			(kind === "brightness" ? JSON.stringify(action.Encoder) !== '{"layout":"$B1"}' : action.Encoder !== undefined) ||
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
			if (excluded(relative)) {
				if (!options.softwareOnly) fail("private/development file in complete payload");
				continue;
			}
			if (stat.isDirectory()) walk(relative);
			else if (relative !== ".sdignore") {
				if (!stat.isFile()) fail("nonregular runtime file");
				const native = relative.startsWith("controller/");
				if (!native && stat.mode & 0o111) fail("unexpected executable runtime asset");
				files.push(relative);
			}
		}
	};
	walk();
	validateEntries(
		files.map((path) => `${runtimeName}/${path}`),
		options,
	);
	if (!options.softwareOnly) checkStamp(directory, manifest.Version, options);
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

// release.json is the installed version: exactly {tag, build}, agreeing with manifest X.Y.Z.build.
export function checkStamp(directory, version, options = {}) {
	const path = join(directory, "release.json");
	const expectedTag = Object.hasOwn(options, "expectedTag") ? options.expectedTag : process.env.MERGBW_EXPECTED_TAG;
	let stamp;
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.size > 4096) throw new Error();
		stamp = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		fail("release stamp unreadable");
	}
	const match = typeof stamp?.tag === "string" ? releaseTag.exec(stamp.tag) : null;
	if (
		!match ||
		Array.isArray(stamp) ||
		Object.keys(stamp).sort().join() !== "build,tag" ||
		!Number.isSafeInteger(stamp.build) ||
		stamp.build < 0 ||
		version !== `${match[1]}.${match[2]}.${match[3]}.${stamp.build}`
	)
		fail("release stamp does not match manifest version");
	if (expectedTag && (stamp.tag !== expectedTag || stamp.build !== 0)) fail("expected release tag or build mismatch");
	return stamp;
}
export function inspectionTool(command, args) {
	const result = spawnSync(command, args, { encoding: "utf8", timeout: 120000 });
	if (result.error || result.status !== 0) fail(`native inspection failed: ${command}`);
	return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
function localProvenance() {
	const root = fileURLToPath(new URL("../../", import.meta.url));
	const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
	const names = execFileSync(
		"git",
		["ls-files", "-co", "--exclude-standard", "--", "cmd", "internal", "go.mod", "go.sum"],
		{ cwd: root, encoding: "utf8" },
	)
		.trim()
		.split("\n");
	const digest = createHash("sha256");
	for (const name of [...new Set(names)].sort()) {
		if (name === "go.mod" || name === "go.sum" || name.endsWith(".go")) {
			const path = join(root, name);
			if (lstatSync(path).isSymbolicLink()) fail("source symlink");
			digest
				.update(name + "\0")
				.update(readFileSync(path))
				.update("\0");
		}
	}
	return { sourceRevision: revision, sourceTreeSHA256: digest.digest("hex") };
}
export function checkPayload(directory, options = {}) {
	const mode = options.packageMode ?? "development";
	if (!["development", "distribution"].includes(mode)) fail("unsupported package mode");
	const provenance = options.sourceRevision && options.sourceTreeSHA256 ? options : localProvenance();
	const { manifest, supervisor, worker } = validateNativePayload(directory, {
		fullPackage: true,
		sourceRevision: provenance.sourceRevision,
		sourceTreeSHA256: provenance.sourceTreeSHA256,
	});
	if (manifest.buildMode !== mode) fail("payload build mode does not match package mode");
	const inspectPlist = `import plistlib,sys
with open(sys.argv[1],'rb') as f: info=plistlib.load(f)
expected={'CFBundleIdentifier':'com.obalunenko.mergbw.controller','CFBundleExecutable':'mergbw-supervisor','LSMinimumSystemVersion':'13.5','CFBundlePackageType':'APPL','LSUIElement':True}
if not isinstance(info,dict) or any(info.get(k)!=v for k,v in expected.items()) or not isinstance(info.get('NSBluetoothAlwaysUsageDescription'),str) or not info['NSBluetoothAlwaysUsageDescription'].strip(): raise ValueError('incompatible native plist')`;
	try {
		execFileSync(
			"python3",
			["-c", inspectPlist, join(directory, "controller/MeRGBW Controller.app/Contents/Info.plist")],
			{ stdio: "pipe" },
		);
	} catch {
		fail("actual native plist identity/privacy/minimum is incompatible");
	}

	for (const language of ["en", "ru"]) {
		const description = readFileSync(
			join(directory, `controller/MeRGBW Controller.app/Contents/Resources/${language}.lproj/InfoPlist.strings`),
			"utf8",
		);
		if ([...description.matchAll(/^\s*"NSBluetoothAlwaysUsageDescription"\s*=\s*"[^"\r\n]+"\s*;\s*$/gm)].length !== 1)
			fail("localized Bluetooth privacy description missing");
	}
	const notice = readFileSync(join(directory, "licenses/go-native-notices.txt"), "utf8");
	if (!notice.includes("Go and native dependency licenses") || !notice.includes("Copyright"))
		fail("Go/native dependency notices");
	if ((options.platform ?? process.platform) !== "darwin") fail("complete signature inspection requires macOS");
	const runner = options.runner ?? inspectionTool;
	const app = join(directory, "controller/MeRGBW Controller.app");
	for (const binary of [supervisor, worker]) {
		const libraries = runner("otool", ["-arch", "all", "-L", binary]);
		const dependencies = [...libraries.matchAll(/^\s+(\S+) \(compatibility version/gm)].map((match) => match[1]);
		if (
			!dependencies.length ||
			dependencies.some((path) => !path.startsWith("/usr/lib/") && !path.startsWith("/System/Library/"))
		)
			fail("unexpected native dynamic library");
		const load = runner("otool", ["-arch", "all", "-l", binary]);
		if (
			/cmd LC_RPATH/.test(load) ||
			[...load.matchAll(/cmd LC_LOAD_DYLINKER[\s\S]*?name ([^\s]+)/g)].some((match) => match[1] !== "/usr/lib/dyld")
		)
			fail("unexpected native interpreter or rpath");
	}

	for (const path of [worker, app]) {
		runner("codesign", ["--verify", "--strict", "--all-architectures", path]);
		if (mode === "distribution") {
			const signature = runner("codesign", ["--display", "--verbose=4", path]);
			if (
				!/Authority=Developer ID Application:/.test(signature) ||
				!/TeamIdentifier=.+/.test(signature) ||
				!/flags=.*\(runtime\)/.test(signature) ||
				!/Timestamp=.+/.test(signature) ||
				/Signature=adhoc|TeamIdentifier=not set/.test(signature)
			)
				fail("Developer ID/hardened runtime/timestamp missing");
		}
		const entitlements = runner("codesign", ["--display", "--entitlements", ":-", path]);
		if (/<key>/.test(entitlements)) fail("unexpected native entitlements");
	}
	// Inspect both roles; supervisor is covered by the outer app signature.
	if (!supervisor.endsWith("/MacOS/mergbw-supervisor")) fail("supervisor path");
	if (mode === "distribution") runner("xcrun", ["stapler", "validate", app]);
	return manifest;
}
export function checkArchive(archive, options = {}) {
	// Read central-directory metadata before extraction. Never repair malformed modes.
	const inspect = `import json,stat,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 print(json.dumps([{'name':i.filename,'mode':i.external_attr>>16,'size':i.file_size} for i in z.infolist()]))`;
	const entries = JSON.parse(execFileSync("python3", ["-c", inspect, archive], { encoding: "utf8" }));
	const files = validateEntries(
		entries.map((entry) => entry.name),
		options,
	);
	for (const entry of entries) {
		const type = entry.mode & 0o170000;
		if (type === 0o120000 || (type && type !== (entry.name.endsWith("/") ? 0o040000 : 0o100000)))
			fail("archive symlink/nonregular entry");
		if (entry.size > 128 * 1024 * 1024) fail("oversized archive entry");
		if (!entry.name.endsWith("/") && entry.name.includes("/controller/")) {
			const executable = /\/(MacOS|Helpers)\//.test(entry.name);
			if ((entry.mode & 0o7777) !== (executable ? 0o755 : 0o644)) fail("archive native mode changed");
		}
	}
	const temporary = mkdtempSync(join(tmpdir(), "mergbw-extracted-"));
	try {
		execFileSync("unzip", ["-q", archive, "-d", temporary]);
		// .sdignore is packer input, excluded from the installer. Restore only that
		// public policy file so the exact same runtime inspection covers extracted bytes.
		const directory = join(temporary, runtimeName);
		writeFileSync(join(directory, ".sdignore"), ignoreRules.join("\n") + "\n");
		checkRuntime(directory, options);
		return files;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const directory = fileURLToPath(new URL(`../${runtimeName}/`, import.meta.url));
		const mode = process.env.PACKAGE_MODE ?? "development";
		const softwareOnly = process.argv.includes("--software");
		const options = { packageMode: mode, softwareOnly, sourceDirectory: directory };
		const chosenDirectory = process.argv[2] === "--directory" ? resolve(process.argv[3]) : directory;
		const files = process.argv[2] === "--archive" ? [] : checkRuntime(chosenDirectory, options);
		if (process.argv[2] === "--archive") {
			if (!process.argv[3]) fail("archive argument missing");
			const entries = checkArchive(resolve(process.argv[3]), options);
			console.log(`Installer checked: ${entries.length} files (${basename(process.argv[3])}).`);
		} else if (process.argv[2] && !["--software", "--directory"].includes(process.argv[2])) fail("unknown argument");
		console.log(`Runtime checked: ${files.length} files, seven actions, local assets and licenses.`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : "Package check failed");
		process.exitCode = 1;
	}
}
