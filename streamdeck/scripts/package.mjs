// Author an installer from the pinned packer, then verify its extracted bytes.
// Elgato CLI 1.10.3 omits Unix ZIP modes. Set them during installer creation
// from the already inspected source; downloaded installers are never repaired.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkArchive, checkRuntime, validateEntries } from "./check-package.mjs";

export function preserveInstallerModes(archive, directory, options = {}) {
	checkRuntime(directory, options);
	const listing = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split(/\r?\n/);
	validateEntries(listing, options);
	const author = `import hashlib,json,os,pathlib,stat,sys,tempfile,zipfile
archive,root=map(pathlib.Path,sys.argv[1:])
manifest=json.loads((root/'controller/payload-manifest.json').read_text())
native={root.name+'/controller/'+e['path']:e for e in manifest['files']}
fd,temporary=tempfile.mkstemp(prefix='.mergbw-installer-',dir=archive.parent)
os.close(fd)
try:
 with zipfile.ZipFile(archive) as source,zipfile.ZipFile(temporary,'w') as target:
  for entry in source.infolist():
   data=source.read(entry)
   if entry.filename in native:
    expected=native[entry.filename]
    if hashlib.sha256(data).hexdigest()!=expected['sha256']: raise ValueError('packer changed native signed bytes')
    mode=int(expected['mode'],8)
   else:
    mode=0o755 if entry.is_dir() else 0o644
   entry.create_system=3
   entry.external_attr=((stat.S_IFDIR if entry.is_dir() else stat.S_IFREG)|mode)<<16
   target.writestr(entry,data)
 os.replace(temporary,archive)
finally:
 if os.path.exists(temporary): os.unlink(temporary)`;
	execFileSync("python3", ["-c", author, archive, directory], { stdio: "pipe" });
}
export function packPlugin(directory, output, options = {}) {
	checkRuntime(directory, options);
	const cli = createRequire(import.meta.url).resolve("@elgato/cli/bin/streamdeck.mjs");
	mkdirSync(output, { recursive: true });
	const temporary = mkdtempSync(resolve(output, ".mergbw-pack-"));
	try {
		execFileSync(process.execPath, [cli, "pack", directory, "--output", temporary, "--force", "--no-update-check"], {
			stdio: "pipe",
		});
		const archive = resolve(temporary, "com.obalunenko.mergbw.streamDeckPlugin");
		preserveInstallerModes(archive, directory, options);
		checkArchive(archive, options);
		const final = resolve(
			output,
			options.packageMode === "distribution"
				? "com.obalunenko.mergbw.streamDeckPlugin"
				: "com.obalunenko.mergbw.development.streamDeckPlugin",
		);
		renameSync(archive, final);
		return final;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const directory = fileURLToPath(new URL("../../dist/plugin-stage/com.obalunenko.mergbw.sdPlugin", import.meta.url));
		const output = fileURLToPath(new URL("../../dist", import.meta.url));
		const sourceDirectory = fileURLToPath(new URL("../com.obalunenko.mergbw.sdPlugin", import.meta.url));
		console.log(
			`Verified installer: ${packPlugin(directory, output, { packageMode: process.env.PACKAGE_MODE ?? "development", sourceDirectory })}`,
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : "Installer creation failed");
		process.exitCode = 1;
	}
}
