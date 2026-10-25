import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { nativeFiles } from "../native/payload-validator.mjs";
import { checkArchive, checkRuntime, validateEntries } from "../scripts/check-package.mjs";
import { packPlugin, preserveInstallerModes } from "../scripts/package.mjs";

function runtime(): { directory: string; clean: () => void } {
	const temporary = mkdtempSync(join(tmpdir(), "mergbw-package-"));
	const directory = join(temporary, "com.obalunenko.mergbw.sdPlugin");
	cpSync(resolve("com.obalunenko.mergbw.sdPlugin"), directory, { recursive: true });
	// Build-independent fixture: package tests run before the production build in CI.
	mkdirSync(join(directory, "bin"), { recursive: true });
	writeFileSync(join(directory, "bin/plugin.js"), 'import fs from "node:fs";\n');
	writeFileSync(join(directory, "bin/package.json"), '{"type":"module"}');
	writeFileSync(join(directory, "ui/inspector.js"), 'console.log("synthetic inspector");');
	return { directory, clean: () => rmSync(temporary, { recursive: true, force: true }) };
}

test("package requires six actions and every runtime asset/license", () => {
	const { directory, clean } = runtime();
	try {
		const files = checkRuntime(directory, { softwareOnly: true });
		assert.equal(files.length, 30);
		assert.equal(JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")).Version, "0.2.0.0");
		assert.ok(files.includes("licenses/ws.txt"));
		const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
		manifest.Actions.pop();
		writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
		assert.throws(() => checkRuntime(directory, { softwareOnly: true }), /six actions/);
	} finally {
		clean();
	}
});

test("missing assets, altered vendor bytes and remote UI assets fail delivery", () => {
	for (const fault of ["asset", "vendor", "remote", "license", "dependency", "ignore"]) {
		const { directory, clean } = runtime();
		try {
			if (fault === "asset") unlinkSync(join(directory, "imgs/color@2x.png"));
			if (fault === "vendor") writeFileSync(join(directory, "ui/vendor/sdpi-components.js"), "altered");
			if (fault === "remote")
				writeFileSync(join(directory, "ui/index.html"), '<script src="https://example.invalid/ui.js"></script>');
			if (fault === "license") writeFileSync(join(directory, "licenses/ws.txt"), "missing terms");
			if (fault === "dependency")
				writeFileSync(join(directory, "bin/plugin.js"), 'import remote from "undeclared-package";');
			if (fault === "ignore") writeFileSync(join(directory, ".sdignore"), "logs/\n");
			assert.throws(() => checkRuntime(directory, { softwareOnly: true }), /Package check:/);
		} finally {
			clean();
		}
	}
});

test("only Brightness supports Encoder and requires the exact built-in indicator layout", () => {
	for (const fault of ["missing-encoder", "extra-encoder", "layout", "extra-layout"]) {
		const { directory, clean } = runtime();
		try {
			const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
			const brightness = manifest.Actions.find((action: { UUID: string }) => action.UUID.endsWith(".brightness"));
			assert.deepEqual(brightness.Controllers, ["Keypad", "Encoder"]);
			assert.deepEqual(brightness.Encoder, { layout: "$B1" });
			if (fault === "missing-encoder") brightness.Controllers = ["Keypad"];
			if (fault === "extra-encoder") manifest.Actions[0].Controllers.push("Encoder");
			if (fault === "layout") brightness.Encoder.layout = "$A1";
			if (fault === "extra-layout") manifest.Actions[0].Encoder = { layout: "$B1" };
			writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
			assert.throws(() => checkRuntime(directory, { softwareOnly: true }), /action paths or behavior/);
		} finally {
			clean();
		}
	}
});

test("private/dev paths are ignored at source and forbidden in installer entries", () => {
	const { directory, clean } = runtime();
	try {
		const files = checkRuntime(directory, { softwareOnly: true });
		writeFileSync(join(directory, "settings.json"), '{"accessToken":"synthetic-only"}');
		writeFileSync(join(directory, "private-fixture.json"), "{}");
		assert.throws(() => checkRuntime(directory, { softwareOnly: true }), /unexpected distribution file/);
		unlinkSync(join(directory, "private-fixture.json"));
		assert.deepEqual(checkRuntime(directory, { softwareOnly: true }), files);
		const entries = files.map((file) => `com.obalunenko.mergbw.sdPlugin/${file}`);
		assert.deepEqual(validateEntries(entries, { softwareOnly: true }).sort(), files);
		for (const path of [
			"settings.json",
			"logs/plugin.log",
			"tests/private.ts",
			"ui/inspector.js.map",
			"../escape",
			"fixtures/private.json",
		]) {
			assert.throws(
				() => validateEntries([...entries, `com.obalunenko.mergbw.sdPlugin/${path}`], { softwareOnly: true }),
				/Package check:/,
			);
		}
		assert.throws(() => validateEntries([...entries, entries[0]!], { softwareOnly: true }), /duplicate/);
		assert.throws(() => validateEntries(entries.slice(1), { softwareOnly: true }), /missing/);
	} finally {
		clean();
	}
});

test("pinned packer excludes synthetic private files from the actual installer", () => {
	const { directory, clean } = runtime();
	try {
		writeFileSync(join(directory, "settings.json"), '{"accessToken":"synthetic-only"}');
		writeFileSync(join(directory, "presets.json"), "{}");
		writeFileSync(join(directory, "streamdeck-buttons.txt"), "synthetic-only");
		writeFileSync(join(directory, "ui/inspector.js.map"), "{}");
		for (const folder of ["logs", "tests", "fixtures"]) {
			mkdirSync(join(directory, folder));
			writeFileSync(join(directory, folder, "private.txt"), "synthetic-only");
		}
		const output = join(directory, "..", "dist");
		execFileSync(
			process.execPath,
			[
				resolve("node_modules/@elgato/cli/bin/streamdeck.mjs"),
				"pack",
				directory,
				"--output",
				output,
				"--force",
				"--no-update-check",
			],
			{ stdio: "pipe", timeout: 30000 },
		);
		const files = checkArchive(join(output, "com.obalunenko.mergbw.streamDeckPlugin"), { softwareOnly: true });
		assert.equal(files.length, 30);
		assert.ok(!files.some((file) => /private|settings|presets.json|buttons|\.map$/.test(file)));
	} finally {
		clean();
	}
});

const provenance = { sourceRevision: "a".repeat(40), sourceTreeSHA256: "b".repeat(64) };
const inspectionCalls: string[][] = [];
const completeOptions = {
	...provenance,
	packageMode: "distribution",
	platform: "darwin",
	runner: (command: string, args: string[]) => {
		inspectionCalls.push([command, ...args]);
		if (command === "otool")
			return args.includes("-L")
				? "synthetic:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)"
				: "cmd LC_LOAD_DYLINKER\nname /usr/lib/dyld (offset 12)";

		return command === "codesign" && args.includes("--verbose=4")
			? "Authority=Developer ID Application: Synthetic\nTeamIdentifier=SYNTHETIC\nflags=0x10000(runtime)\nTimestamp=synthetic\n"
			: "";
	},
};
function universal(): Buffer {
	const bytes = Buffer.alloc(160);
	bytes.writeUInt32BE(0xcafebabe, 0);
	bytes.writeUInt32BE(2, 4);
	for (const [index, cpu] of [16777228, 16777223].entries()) {
		const header = 8 + index * 20,
			offset = 48 + index * 56;
		bytes.writeUInt32BE(cpu, header);
		bytes.writeUInt32BE(offset, header + 8);
		bytes.writeUInt32BE(56, header + 12);
		bytes.writeUInt32LE(0xfeedfacf, offset);
		bytes.writeUInt32LE(cpu, offset + 4);
		bytes.writeUInt32LE(2, offset + 12);
		bytes.writeUInt32LE(1, offset + 16);
		bytes.writeUInt32LE(24, offset + 20);
		bytes.writeUInt32LE(0x32, offset + 32);
		bytes.writeUInt32LE(24, offset + 36);
		bytes.writeUInt32LE(1, offset + 40);
		bytes.writeUInt32LE(0x000d0500, offset + 44);
	}
	return bytes;
}
function payload(directory: string, mode = "distribution") {
	const files = [
		...nativeFiles,
		...(mode === "distribution" ? ["MeRGBW Controller.app/Contents/CodeResources"] : []),
	].map((name) => {
		const executable = /\/(?:MacOS|Helpers)\//.test(name);
		const bytes = executable
			? universal()
			: name.endsWith("/Info.plist")
				? readFileSync(resolve("native/Info.plist"))
				: name.endsWith("InfoPlist.strings")
					? Buffer.from('"NSBluetoothAlwaysUsageDescription" = "Synthetic local lamp permission";')
					: Buffer.from("synthetic signature or ticket");
		const path = join(directory, "controller", name);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, bytes, { mode: executable ? 0o755 : 0o644 });
		return { path: name, sha256: createHash("sha256").update(bytes).digest("hex"), mode: executable ? "0755" : "0644" };
	});
	writeFileSync(
		join(directory, "licenses/go-native-notices.txt"),
		"Go and native dependency licenses\nCopyright fixture\n",
	);
	const manifest = {
		schemaVersion: 1,
		...provenance,
		managedProtocolVersion: 1,
		bridgeVersion: "2.0.0-go",
		buildMode: mode,
		architectures: ["arm64", "x86_64"],
		minimumMacOS: "13.5",
		files,
	};
	const save = () =>
		writeFileSync(join(directory, "controller/payload-manifest.json"), JSON.stringify(manifest), { mode: 0o644 });
	save();
	return { manifest, save };
}

test("complete package requires exact source/schema/protocol/build metadata and finite native bytes", () => {
	const { directory, clean } = runtime();
	try {
		assert.throws(() => checkRuntime(directory, completeOptions), /binary_missing/);
		const { manifest, save } = payload(directory);
		assert.ok(checkRuntime(directory, completeOptions).includes("controller/payload-manifest.json"));
		for (const [field, value] of Object.entries({
			schemaVersion: 2,
			sourceRevision: "c".repeat(40),
			sourceTreeSHA256: "c".repeat(64),
			managedProtocolVersion: 2,
			bridgeVersion: "foreign",
			buildMode: "spike",
			minimumMacOS: "13.0",
		})) {
			const original = Reflect.get(manifest, field);
			Reflect.set(manifest, field, value);
			save();
			assert.throws(() => checkRuntime(directory, completeOptions), /binary_incompatible/);
			Reflect.set(manifest, field, original);
			save();
		}
		for (const fault of ["duplicate", "traversal", "mode", "hash"]) {
			const original = structuredClone(manifest.files);
			if (fault === "duplicate") manifest.files[1] = manifest.files[0]!;
			if (fault === "traversal") manifest.files[0]!.path = "../private";
			if (fault === "mode") manifest.files[0]!.mode = "0755";
			if (fault === "hash") manifest.files[0]!.sha256 = "0".repeat(64);
			save();
			assert.throws(() => checkRuntime(directory, completeOptions), /binary_incompatible/);
			manifest.files = original;
			save();
		}
		for (const name of [
			"unexpected-executable",
			"settings.json",
			"presets.json",
			".env",
			"src/private.go",
			"fixtures/source.json",
			"logs/private.log",
		]) {
			const path = join(directory, "controller", name);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, "synthetic", { mode: 0o755 });
			assert.throws(() => checkRuntime(directory, completeOptions), /binary_incompatible|unexpected distribution/);
			rmSync(path); // Empty untrusted directories are also invalid.
			if (name.includes("/")) rmSync(dirname(path), { recursive: true });
		}
		const worker = join(directory, "controller/MeRGBW Controller.app/Contents/Helpers/sunset");
		chmodSync(worker, 0o644);
		assert.throws(() => checkRuntime(directory, completeOptions), /binary_incompatible/);
		chmodSync(worker, 0o755);
		unlinkSync(worker);
		symlinkSync("/synthetic/missing", worker);
		assert.throws(() => checkRuntime(directory, completeOptions), /binary_incompatible/);
	} finally {
		clean();
	}
});

test("development is the default and cannot pass explicit distribution or skip two native architectures", () => {
	const { directory, clean } = runtime();
	try {
		const { manifest, save } = payload(directory, "development");
		assert.throws(() => checkRuntime(directory, completeOptions), /mode/);
		const options = { ...completeOptions, packageMode: undefined };
		inspectionCalls.length = 0;
		assert.ok(checkRuntime(directory, options).length > 28);
		assert.ok(!inspectionCalls.some((call) => call[0] === "xcrun" || call.includes("--verbose=4")));
		manifest.architectures = ["arm64"];
		save();
		assert.throws(
			() => checkRuntime(directory, { ...completeOptions, packageMode: "development" }),
			/binary_incompatible/,
		);
	} finally {
		clean();
	}
});

test("extracted installer preserves native hashes/modes/signature/ticket and verifies extracted app", () => {
	const { directory, clean } = runtime();
	try {
		payload(directory);
		const archive = join(directory, "..", "complete.zip");
		const pack = () => {
			rmSync(archive, { force: true });
			execFileSync("zip", ["-q", "-r", archive, "com.obalunenko.mergbw.sdPlugin", "-x", "*/.sdignore"], {
				cwd: dirname(directory),
			});
		};
		execFileSync(
			process.execPath,
			[
				resolve("node_modules/@elgato/cli/bin/streamdeck.mjs"),
				"pack",
				directory,
				"--output",
				join(directory, "..", "packed"),
				"--force",
				"--no-update-check",
			],
			{ stdio: "pipe", timeout: 30000 },
		);
		const packedArchive = join(directory, "..", "packed/com.obalunenko.mergbw.streamDeckPlugin");
		assert.throws(() => checkArchive(packedArchive, completeOptions), /archive native mode changed/);
		preserveInstallerModes(packedArchive, directory, completeOptions);
		assert.ok(checkArchive(packedArchive, completeOptions).length > 28);
		pack();
		inspectionCalls.length = 0;
		assert.ok(checkArchive(archive, completeOptions).length > 28);
		assert.ok(
			inspectionCalls.some(
				([tool, ...args]) =>
					tool === "xcrun" && args.includes("validate") && args.some((arg) => arg.includes("mergbw-extracted-")),
			),
		);
		const worker = join(directory, "controller/MeRGBW Controller.app/Contents/Helpers/sunset");
		chmodSync(worker, 0o644);
		pack();
		assert.throws(() => checkArchive(archive, completeOptions), /mode|binary_incompatible/);
		chmodSync(worker, 0o755);
		writeFileSync(join(directory, "controller/MeRGBW Controller.app/Contents/CodeResources"), "");
		pack();
		assert.throws(() => checkArchive(archive, completeOptions), /binary_incompatible/);
	} finally {
		clean();
	}
});

test("archive directory traversal, duplicate directories, symlinks and unexpected executables fail before extraction", () => {
	const { directory, clean } = runtime();
	try {
		payload(directory);
		const files = checkRuntime(directory, completeOptions).map((file) => `com.obalunenko.mergbw.sdPlugin/${file}`);
		for (const extra of [
			"../escape",
			"com.obalunenko.mergbw.sdPlugin/controller/../secret",
			"com.obalunenko.mergbw.sdPlugin/evil-executable",
			"com.obalunenko.mergbw.sdPlugin/controller/extra.dylib",
		])
			assert.throws(() => validateEntries([...files, extra]), /Package check:/);
		assert.throws(
			() =>
				validateEntries([
					...files,
					"com.obalunenko.mergbw.sdPlugin/controller/",
					"com.obalunenko.mergbw.sdPlugin/controller/",
				]),
			/duplicate/,
		);
		const archive = join(directory, "..", "symlink.zip");
		execFileSync("python3", [
			"-c",
			`import pathlib,stat,sys,zipfile
root=pathlib.Path(sys.argv[2])
with zipfile.ZipFile(sys.argv[1],'w') as archive:
 for path in root.rglob('*'):
  if not path.is_file() or path.name=='.sdignore': continue
  info=zipfile.ZipInfo(root.name+'/'+path.relative_to(root).as_posix())
  info.create_system=3
  info.external_attr=(stat.S_IFREG|stat.S_IMODE(path.stat().st_mode))<<16
  if path.name=='sunset': info.external_attr=0o120755<<16
  archive.writestr(info,path.read_bytes())`,
			archive,
			directory,
		]);
		assert.throws(() => checkArchive(archive, completeOptions), /archive symlink/);
	} finally {
		clean();
	}
});

test("development installer creation cannot replace a previous distribution on success or failure", () => {
	const { directory, clean } = runtime();
	try {
		payload(directory, "development");
		const output = join(directory, "..", "installers");
		mkdirSync(output);
		const distribution = join(output, "com.obalunenko.mergbw.streamDeckPlugin");
		writeFileSync(distribution, "previous verified distribution");
		const options = { ...completeOptions, packageMode: undefined };
		assert.ok(packPlugin(directory, output, options).endsWith(".development.streamDeckPlugin"));
		assert.equal(readFileSync(distribution, "utf8"), "previous verified distribution");
		assert.throws(
			() =>
				packPlugin(directory, output, {
					...options,
					runner: (tool: string, args: string[]) => {
						if (args.some((arg) => arg.includes("mergbw-extracted-")))
							throw new Error("synthetic extracted signature failure");
						return options.runner(tool, args);
					},
				}),
			/synthetic extracted signature failure/,
		);
		assert.equal(readFileSync(distribution, "utf8"), "previous verified distribution");
	} finally {
		clean();
	}
});

test("rehashed wrong bundle identity/minimum/privacy and non-system native dependencies are rejected", () => {
	const { directory, clean } = runtime();
	try {
		const { manifest, save } = payload(directory);
		const plistEntry = manifest.files.find((file) => file.path.endsWith("/Info.plist"))!;
		const plistPath = join(directory, "controller", plistEntry.path);
		const original = readFileSync(plistPath, "utf8");
		for (const [from, to] of [
			["com.obalunenko.mergbw.controller", "foreign.bundle"],
			["mergbw-supervisor", "foreign-executable"],
			["<string>13.5</string>", "<string>13.0</string>"],
			["NSBluetoothAlwaysUsageDescription", "MissingPrivacy"],
		]) {
			const bytes = original.replace(from!, to!);
			writeFileSync(plistPath, bytes);
			plistEntry.sha256 = createHash("sha256").update(bytes).digest("hex");
			save();
			assert.throws(() => checkRuntime(directory, completeOptions), /binary_incompatible/);
		}
		const duplicate = original.replace(
			"</dict>",
			"<key>CFBundleExecutable</key><string>foreign-last-executable</string></dict>",
		);
		writeFileSync(plistPath, duplicate);
		plistEntry.sha256 = createHash("sha256").update(duplicate).digest("hex");
		save();
		assert.throws(() => checkRuntime(directory, completeOptions), /actual native plist/);
		const commentSpoof = original.replace(
			"<key>CFBundleExecutable</key><string>mergbw-supervisor</string>",
			"<!-- <key>CFBundleExecutable</key><string>mergbw-supervisor</string> -->",
		);
		writeFileSync(plistPath, commentSpoof);
		plistEntry.sha256 = createHash("sha256").update(commentSpoof).digest("hex");
		save();
		assert.throws(() => checkRuntime(directory, completeOptions), /actual native plist/);
		writeFileSync(plistPath, original);
		plistEntry.sha256 = createHash("sha256").update(original).digest("hex");
		save();
		for (const language of ["en", "ru"]) {
			const entry = manifest.files.find((file) => file.path.includes(`/${language}.lproj/`))!;
			const path = join(directory, "controller", entry.path),
				bytes = readFileSync(path);
			writeFileSync(path, "missing localized description");
			entry.sha256 = createHash("sha256").update("missing localized description").digest("hex");
			save();
			assert.throws(() => checkRuntime(directory, completeOptions), /localized Bluetooth/);
			writeFileSync(path, bytes);
			entry.sha256 = createHash("sha256").update(bytes).digest("hex");
			save();
		}
		for (const dependency of [
			"@rpath/private.dylib",
			"/opt/homebrew/lib/private.dylib",
			"/Users/synthetic/lib/private.dylib",
		]) {
			assert.throws(
				() =>
					checkRuntime(directory, {
						...completeOptions,
						runner: (tool: string, args: string[]) =>
							tool === "otool" && args.includes("-L")
								? `synthetic:\n\t${dependency} (compatibility version 1.0.0)`
								: completeOptions.runner(tool, args),
					}),
				/dynamic library/,
			);
		}
	} finally {
		clean();
	}
});

test("full source gate rejects a stale staged JavaScript/UI/manifest after software rebuild", () => {
	const { directory, clean } = runtime();
	try {
		payload(directory);
		const sourceDirectory = join(directory, "..", "current-built-source");
		cpSync(directory, sourceDirectory, { recursive: true });
		const options = { ...completeOptions, sourceDirectory };
		assert.ok(checkRuntime(directory, options).length > 28);
		for (const file of ["bin/plugin.js", "ui/inspector.js", "ui/inspector.css", "manifest.json"]) {
			const path = join(sourceDirectory, file),
				original = readFileSync(path);
			writeFileSync(
				path,
				file === "manifest.json"
					? JSON.stringify({ ...JSON.parse(original.toString()), Name: "Updated name" })
					: Buffer.concat([original, Buffer.from("\n/* rebuilt source */")]),
			);
			assert.throws(() => checkRuntime(directory, options), /staged runtime differs/);
			writeFileSync(path, original);
		}
	} finally {
		clean();
	}
});
