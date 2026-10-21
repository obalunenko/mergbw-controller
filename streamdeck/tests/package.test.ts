import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { checkArchive, checkRuntime, validateEntries } from "../scripts/check-package.mjs";

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

test("package requires five actions and every runtime asset/license", () => {
	const { directory, clean } = runtime();
	try {
		const files = checkRuntime(directory);
		assert.equal(files.length, 28);
		assert.ok(files.includes("licenses/ws.txt"));
		const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
		manifest.Actions.pop();
		writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
		assert.throws(() => checkRuntime(directory), /five actions/);
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
			assert.throws(() => checkRuntime(directory), /Package check:/);
		} finally {
			clean();
		}
	}
});

test("private/dev paths are ignored at source and forbidden in installer entries", () => {
	const { directory, clean } = runtime();
	try {
		const files = checkRuntime(directory);
		writeFileSync(join(directory, "settings.json"), '{"accessToken":"synthetic-only"}');
		writeFileSync(join(directory, "private-fixture.json"), "{}");
		assert.throws(() => checkRuntime(directory), /unexpected distribution file/);
		unlinkSync(join(directory, "private-fixture.json"));
		assert.deepEqual(checkRuntime(directory), files);
		const entries = files.map((file) => `com.obalunenko.mergbw.sdPlugin/${file}`);
		assert.deepEqual(validateEntries(entries).sort(), files);
		for (const path of [
			"settings.json",
			"logs/plugin.log",
			"tests/private.ts",
			"ui/inspector.js.map",
			"../escape",
			"fixtures/private.json",
		]) {
			assert.throws(() => validateEntries([...entries, `com.obalunenko.mergbw.sdPlugin/${path}`]), /Package check:/);
		}
		assert.throws(() => validateEntries([...entries, entries[0]!]), /duplicate/);
		assert.throws(() => validateEntries(entries.slice(1)), /missing/);
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
		const files = checkArchive(join(output, "com.obalunenko.mergbw.streamDeckPlugin"));
		assert.equal(files.length, 28);
		assert.ok(!files.some((file) => /private|settings|presets.json|buttons|\.map$/.test(file)));
	} finally {
		clean();
	}
});
