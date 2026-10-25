// Shared runtime/package inspection. Never execute a candidate to identify it.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const nativeFiles = [
	"Info.plist",
	"MacOS/mergbw-supervisor",
	"Helpers/sunset",
	"Resources/en.lproj/InfoPlist.strings",
	"Resources/ru.lproj/InfoPlist.strings",
	"_CodeSignature/CodeResources",
].map((name) => `MeRGBW Controller.app/Contents/${name}`);
// stapler(1), BUGS, identifies the app ticket at Contents/CodeResources.
// The signature resource seal at _CodeSignature/CodeResources is distinct.
export const distributionNativeFiles = [...nativeFiles, "MeRGBW Controller.app/Contents/CodeResources"];
const executableFiles = nativeFiles.filter((name) => /\/(?:MacOS|Helpers)\//.test(name));
const reject = (code = "binary_incompatible") => {
	throw new Error(code);
};
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
	object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export function machoArchitectures(bytes) {
	const thin = (data) => {
		if (data.length < 32 || data.readUInt32LE(0) !== 0xfeedfacf || data.readUInt32LE(12) !== 2) reject();
		const arch = { 16777228: "arm64", 16777223: "x86_64" }[data.readUInt32LE(4)];
		if (!arch) reject();
		const count = data.readUInt32LE(16),
			commandsEnd = 32 + data.readUInt32LE(20);
		if (commandsEnd > data.length || count > 4096) reject();
		let offset = 32,
			minimum = false;
		for (let i = 0; i < count; i++) {
			if (offset + 8 > commandsEnd) reject();
			const command = data.readUInt32LE(offset),
				size = data.readUInt32LE(offset + 4);
			if (size < 8 || offset + size > commandsEnd) reject();
			if (command === 0x32 || command === 0x24) {
				if (size < (command === 0x32 ? 24 : 16)) reject();
				if (command === 0x32 && data.readUInt32LE(offset + 8) !== 1) reject();
				if (data.readUInt32LE(offset + (command === 0x32 ? 12 : 8)) !== 0x000d0500) reject();
				minimum = true;
			}
			offset += size;
		}
		if (!minimum || offset !== commandsEnd) reject();
		return arch;
	};
	if (bytes.length < 8) reject();
	if (bytes.readUInt32BE(0) !== 0xcafebabe) return [thin(bytes)];
	const count = bytes.readUInt32BE(4);
	if (count !== 2 || bytes.length < 8 + count * 20) reject();
	const result = [],
		intervals = [];
	for (let i = 0; i < count; i++) {
		const header = 8 + i * 20,
			offset = bytes.readUInt32BE(header + 8),
			size = bytes.readUInt32BE(header + 12);
		if (
			offset < 8 + count * 20 ||
			size < 32 ||
			offset + size > bytes.length ||
			intervals.some(([a, b]) => offset < b && a < offset + size)
		)
			reject();
		intervals.push([offset, offset + size]);
		const arch = thin(bytes.subarray(offset, offset + size));
		if ({ 16777228: "arm64", 16777223: "x86_64" }[bytes.readUInt32BE(header)] !== arch || result.includes(arch))
			reject();
		result.push(arch);
	}
	return result.sort();
}

function inspectNativePayload(pluginRoot, options = {}) {
	const root = resolve(pluginRoot, "controller");
	const stat = (path) => {
		let value;
		try {
			value = lstatSync(path);
		} catch (error) {
			reject(error?.code === "ENOENT" ? "binary_missing" : "binary_incompatible");
		}
		if (value.isSymbolicLink()) reject();
		return value;
	};
	if (!stat(root).isDirectory()) reject();
	const manifestPath = join(root, "payload-manifest.json"),
		manifestStat = stat(manifestPath);
	if (!manifestStat.isFile() || manifestStat.size > 65536 || (manifestStat.mode & 0o7777) !== 0o644) reject();
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch {
		reject();
	}
	if (
		!exact(manifest, [
			"schemaVersion",
			"sourceRevision",
			"sourceTreeSHA256",
			"managedProtocolVersion",
			"bridgeVersion",
			"buildMode",
			"architectures",
			"minimumMacOS",
			"files",
		]) ||
		manifest.schemaVersion !== 1 ||
		manifest.managedProtocolVersion !== 1 ||
		manifest.bridgeVersion !== "2.0.0-go" ||
		manifest.minimumMacOS !== "13.5" ||
		!/^[a-f0-9]{40}$/.test(manifest.sourceRevision) ||
		!/^[a-f0-9]{64}$/.test(manifest.sourceTreeSHA256) ||
		!["spike", "development", "distribution"].includes(manifest.buildMode)
	)
		reject();
	if (options.sourceRevision !== undefined && manifest.sourceRevision !== options.sourceRevision) reject();
	if (options.sourceTreeSHA256 !== undefined && manifest.sourceTreeSHA256 !== options.sourceTreeSHA256) reject();
	const hostArch = options.hostArchitecture ?? { arm64: "arm64", x64: "x86_64" }[process.arch];
	if (
		!Array.isArray(manifest.architectures) ||
		new Set(manifest.architectures).size !== manifest.architectures.length ||
		!manifest.architectures.includes(hostArch) ||
		manifest.architectures.some((arch) => !["arm64", "x86_64"].includes(arch))
	)
		reject();
	if (manifest.buildMode === "spike") {
		if (options.fullPackage || manifest.architectures.length !== 1) reject();
	} else if (manifest.architectures.length !== 2) reject();
	const inventory = manifest.buildMode === "distribution" ? distributionNativeFiles : nativeFiles;
	if (!Array.isArray(manifest.files) || manifest.files.length !== inventory.length) reject();
	const expected = new Map();
	for (const entry of manifest.files) {
		if (
			!exact(entry, ["path", "sha256", "mode"]) ||
			!inventory.includes(entry.path) ||
			expected.has(entry.path) ||
			!/^[a-f0-9]{64}$/.test(entry.sha256) ||
			entry.mode !== (executableFiles.includes(entry.path) ? "0755" : "0644")
		)
			reject();
		expected.set(entry.path, entry);
	}
	const found = [];
	const walk = (directory, prefix) => {
		for (const name of readdirSync(directory)) {
			const relative = prefix ? `${prefix}/${name}` : name,
				path = join(directory, name),
				value = stat(path);
			if (value.isDirectory()) {
				if (!inventory.some((file) => file.startsWith(`${relative}/`))) reject();
				walk(path, relative);
			} else {
				const entry = expected.get(relative);
				if (
					!value.isFile() ||
					!entry ||
					value.size === 0 ||
					value.size > 128 * 1024 * 1024 ||
					(value.mode & 0o7777) !== Number.parseInt(entry.mode, 8)
				)
					reject();
				const bytes = readFileSync(path);
				if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) reject();
				if (relative.endsWith("/Info.plist")) {
					const plist = bytes.toString("utf8");
					for (const [key, value] of [
						["CFBundleIdentifier", "com.obalunenko.mergbw.controller"],
						["CFBundleExecutable", "mergbw-supervisor"],
						["LSMinimumSystemVersion", "13.5"],
					]) {
						const fragment = `<key>${key}</key>`;
						const offset = plist.indexOf(fragment);
						if (
							offset < 0 ||
							!plist
								.slice(offset + fragment.length)
								.trimStart()
								.startsWith(`<string>${value}</string>`)
						)
							reject();
					}
					if (!/<key>NSBluetoothAlwaysUsageDescription<\/key>\s*<string>[^<]+<\/string>/.test(plist)) reject();
				}
				if (
					executableFiles.includes(relative) &&
					machoArchitectures(bytes).sort().join() !== [...manifest.architectures].sort().join()
				)
					reject();
				found.push(relative);
			}
		}
	};
	const app = join(root, "MeRGBW Controller.app");
	if (!stat(app).isDirectory()) reject();
	if (readdirSync(root).sort().join() !== "MeRGBW Controller.app,payload-manifest.json") reject();
	walk(app, "MeRGBW Controller.app");
	if (found.length !== inventory.length) reject();
	return {
		manifest,
		supervisor: join(
			root,
			executableFiles.find((name) => name.endsWith("mergbw-supervisor")),
		),
		worker: join(
			root,
			executableFiles.find((name) => name.endsWith("sunset")),
		),
	};
}

export function validateNativePayload(pluginRoot, options = {}) {
	try {
		return inspectNativePayload(pluginRoot, options);
	} catch (error) {
		reject(error instanceof Error && error.message === "binary_missing" ? "binary_missing" : "binary_incompatible");
	}
}
