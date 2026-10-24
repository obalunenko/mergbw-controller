#!/usr/bin/env python3
"""Build and inspect native payloads without ever executing either candidate."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import subprocess
import tempfile
import tarfile

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = "com.obalunenko.mergbw.sdPlugin"
APP = "controller/MeRGBW Controller.app/Contents"
KINDS = ("plugin", "on", "off", "color", "brightness", "preset", "transition")
LICENSES = ("elgato-streamdeck", "elgato-schemas", "elgato-utils", "ws", "zod", "tslib")
RUNTIME_FILES = (
    "LICENSE", ".sdignore", "manifest.json", "bin/plugin.js", "bin/package.json",
    "ui/index.html", "ui/inspector.css", "ui/inspector.js",
    "ui/vendor/sdpi-components.js", "ui/vendor/LICENSE", "ui/vendor/README.md",
    *(f"imgs/{kind}{suffix}.png" for kind in KINDS for suffix in ("", "@2x")),
    *(f"licenses/{name}.txt" for name in LICENSES),
)
NATIVE_FILES = (
    "Info.plist", "MacOS/mergbw-supervisor", "Helpers/sunset",
    "Resources/en.lproj/InfoPlist.strings", "Resources/ru.lproj/InfoPlist.strings",
    "_CodeSignature/CodeResources",
)

class BuildError(Exception):
    """An allowlisted developer-facing builder failure."""


def run(command, *, cwd, env=None):
    try:
        command = [os.environ.get("GO", "go"), *command[1:]] if command[0] == "go" else command
        return subprocess.run(command, cwd=cwd, env=env, check=True, text=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise BuildError(f"native build/inspection failed: {command[0]}") from exc


def no_symlinks(path):
    """Reject symlinks in every existing component, including directory parents."""
    for component in (path, *path.parents):
        if component.is_symlink():
            raise BuildError("symlink paths are not allowed")


def copy_regular(source, target, mode=0o644):
    no_symlinks(source)
    if not source.is_file():
        raise BuildError("required built asset is missing or not a regular file")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    target.chmod(mode)


def inspect_binary(path, architecture, runner, root):
    arch = runner(["lipo", "-archs", str(path)], cwd=root)
    if sorted(arch.split()) != sorted(architecture.split()):
        raise BuildError("native binary architecture does not match its declared slices")
    load = runner(["otool", "-l", str(path)], cwd=root)
    minimum = []
    for block in re.split(r"Load command \d+", load):
        if "cmd LC_BUILD_VERSION" in block:
            match = re.search(r"\bminos\s+(\d+\.\d+(?:\.\d+)?)", block)
            if match:
                minimum.append(match.group(1))
        elif "cmd LC_VERSION_MIN_MACOSX" in block:
            match = re.search(r"\bversion\s+(\d+\.\d+(?:\.\d+)?)", block)
            if match:
                minimum.append(match.group(1))
    if not minimum or any(tuple(map(int, item.split(".")[:2])) != (13, 5) for item in minimum):
        raise BuildError("native minimum macOS must be exactly 13.5")


    libraries = runner(["otool", "-L", str(path)], cwd=root)
    dependencies = re.findall(r"^\s+(\S+) \(compatibility version", libraries, re.MULTILINE)
    if not dependencies or any(not value.startswith(("/usr/lib/", "/System/Library/")) for value in dependencies):
        raise BuildError("unexpected native dynamic library")
    if "cmd LC_RPATH" in load or any(value != "/usr/lib/dyld" for value in re.findall(r"cmd LC_LOAD_DYLINKER[\s\S]*?name ([^\s]+)", load)):
        raise BuildError("unexpected native interpreter or rpath")


def source_fingerprint(root, runner):
    names = runner(["git", "ls-files", "-co", "--exclude-standard", "--",
                    "cmd", "internal", "go.mod", "go.sum"], cwd=root).splitlines()
    digest = hashlib.sha256()
    for name in sorted(set(names)):
        if name in ("go.mod", "go.sum") or name.endswith(".go"):
            path = root / name
            no_symlinks(path)
            digest.update(name.encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


def spike(output_root, *, root=ROOT, runner=run, system=None, machine=None):
    output_root = Path(output_root)
    if not output_root.is_absolute():
        raise BuildError("--output-root must be absolute")
    no_symlinks(output_root)
    if (system or platform.system()) != "Darwin":
        raise BuildError("spike requires the current native macOS host")
    architecture = {"arm64": ("arm64", "arm64"), "x86_64": ("amd64", "x86_64")}.get(machine or platform.machine())
    if architecture is None:
        raise BuildError("unsupported current Mac architecture")
    target = output_root / PLUGIN
    if target.exists() or target.is_symlink():
        raise BuildError("staged plugin already exists; refusing overwrite")
    source = root / "streamdeck" / PLUGIN
    for name in RUNTIME_FILES:
        no_symlinks(source / name)
        if not (source / name).is_file():
            raise BuildError("run the existing plugin JS build before spike")
    revision = runner(["git", "rev-parse", "HEAD"], cwd=root)
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise BuildError("source revision is unavailable")
    source_hash = source_fingerprint(root, runner)
    bridge_source = (root / "internal/bridge/http.go").read_text()
    match = re.search(r'const Version = "([A-Za-z0-9_.-]+)"', bridge_source)
    if not match:
        raise BuildError("bridge version is unavailable")
    template = root / "streamdeck/native/Info.plist"
    with template.open("rb") as handle:
        info = plistlib.load(handle)
    if (info.get("CFBundleIdentifier") != "com.obalunenko.mergbw.controller"
            or info.get("CFBundleExecutable") != "mergbw-supervisor"
            or info.get("LSMinimumSystemVersion") != "13.5"
            or not info.get("NSBluetoothAlwaysUsageDescription")):
        raise BuildError("native privacy template is incompatible")
    output_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Build in a fresh sibling and expose the final plugin only after inspection.
    # Failed staging is confined to this owned temporary directory.
    with tempfile.TemporaryDirectory(prefix=".mergbw-spike-", dir=output_root) as temporary:
        staged = Path(temporary) / PLUGIN
        staged.mkdir(mode=0o700)
        for name in RUNTIME_FILES:
            copy_regular(source / name, staged / name)
        contents = staged / APP
        copy_regular(template, contents / "Info.plist")
        for language in ("en", "ru"):
            copy_regular(root / f"streamdeck/native/{language}.lproj/InfoPlist.strings",
                         contents / f"Resources/{language}.lproj/InfoPlist.strings")
        supervisor = contents / "MacOS/mergbw-supervisor"
        worker = contents / "Helpers/sunset"
        supervisor.parent.mkdir(parents=True)
        worker.parent.mkdir(parents=True)
        env = {**os.environ, "GOOS": "darwin", "GOARCH": architecture[0],
               "MACOSX_DEPLOYMENT_TARGET": "13.5"}
        runner(["go", "build", "-trimpath", "-ldflags=-macos=13.5.0", "-o", str(supervisor),
                "./cmd/sunset/supervisor"], cwd=root, env={**env, "CGO_ENABLED": "0"})
        runner(["go", "build", "-trimpath", "-o", str(worker), "./cmd/sunset"], cwd=root,
               env={**env, "CGO_ENABLED": "1", "CGO_CFLAGS": "-mmacosx-version-min=13.5",
                    "CGO_LDFLAGS": "-mmacosx-version-min=13.5"})
        for binary in (supervisor, worker):
            binary.chmod(0o755)
            inspect_binary(binary, architecture[1], runner, root)
        notice = staged / "licenses/go-native-notices.txt"
        notice.write_text(notices((supervisor, worker), root, runner))
        notice.chmod(0o644)
        # Ad-hoc signatures need no account or credential, and are explicitly a
        # spike fixture, not Developer ID/notarized distribution evidence.
        runner(["codesign", "--force", "--sign", "-", str(worker)], cwd=root)
        runner(["codesign", "--force", "--sign", "-", str(contents.parent)], cwd=root)
        runner(["codesign", "--verify", "--strict", str(contents.parent)], cwd=root)
        actual = set()
        for path in contents.rglob("*"):
            if path.is_symlink():
                raise BuildError("unexpected native symlink")
            if path.is_file():
                actual.add(path.relative_to(contents).as_posix())
        if actual != set(NATIVE_FILES):
            raise BuildError("unexpected native bundle content")
        entries = []
        for name in sorted(NATIVE_FILES):
            path = contents / name
            mode = 0o755 if name in ("MacOS/mergbw-supervisor", "Helpers/sunset") else 0o644
            path.chmod(mode)
            entries.append({"path": f"MeRGBW Controller.app/Contents/{name}",
                            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "mode": f"{mode:04o}"})
        metadata = {"schemaVersion": 1, "sourceRevision": revision,
                    "sourceTreeSHA256": source_hash, "managedProtocolVersion": 1,
                    "bridgeVersion": match.group(1), "buildMode": "spike",
                    "architectures": [architecture[1]], "minimumMacOS": "13.5", "files": entries}
        manifest = staged / "controller/payload-manifest.json"
        manifest.write_text(json.dumps(metadata, indent=2) + "\n")
        manifest.chmod(0o644)
        # mkdir is exclusive: concurrent builders cannot silently replace output.
        target.mkdir(mode=0o700)
        try:
            for path in staged.iterdir():
                shutil.move(str(path), target / path.name)
        except OSError as exc:
            raise BuildError("could not finalize isolated spike") from exc
    return target



def provenance(root, runner):
    revision = runner(["git", "rev-parse", "HEAD"], cwd=root)
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise BuildError("source revision is unavailable")
    match = re.search(r'const Version = "([A-Za-z0-9_.-]+)"', (root / "internal/bridge/http.go").read_text())
    if not match or match.group(1) != "2.0.0-go":
        raise BuildError("bridge version is incompatible")
    return {"schemaVersion": 1, "sourceRevision": revision,
            "sourceTreeSHA256": source_fingerprint(root, runner),
            "managedProtocolVersion": 1, "bridgeVersion": match.group(1), "minimumMacOS": "13.5"}


def native_host(system, machine):
    if (system or platform.system()) != "Darwin":
        raise BuildError("native build/assembly requires macOS with Xcode tools")
    arch = {"arm64": ("arm64", "arm64"), "x86_64": ("amd64", "x86_64")}.get(machine or platform.machine())
    if not arch:
        raise BuildError("unsupported current Mac architecture")
    return arch


def go_license_path(goroot):
    """Find the upstream license in Go's own tree or Homebrew's libexec layout."""
    primary = goroot / "LICENSE"
    no_symlinks(primary)
    # Homebrew relocates Go's LICENSE beside libexec, not inside GOROOT.
    # Do not search arbitrary ancestors or substitute the project's license.
    source = primary
    if not primary.exists():
        if goroot.name != "libexec":
            raise BuildError("Go standard library/runtime license is unavailable")
        source = goroot.parent / "LICENSE"
    no_symlinks(source)
    if not source.is_file() or source.stat().st_size > 65536:
        raise BuildError("Go standard library/runtime license is unavailable")
    text = source.read_text()
    if (not text.startswith("Copyright 2009 The Go Authors.\n")
            or "Redistribution and use in source and binary forms, with or without" not in text
            or "Neither the name of Google LLC nor the names of its" not in text
            or "THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS" not in text
            or "EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE." not in text):
        raise BuildError("Go standard library/runtime license identity is incompatible")
    return source


def notices(binaries, root, runner):
    # go version -m inspects linked module metadata; it does not invoke the binary.
    modules = set()
    for binary in binaries:
        metadata = runner(["go", "version", "-m", str(binary)], cwd=root)
        for line in metadata.splitlines():
            fields = line.split()
            if fields and fields[0] == "=>":
                raise BuildError("local/replaced linked dependencies are not distributable")
            if len(fields) >= 3 and fields[0] == "dep":
                modules.add((fields[1], fields[2]))
    goroot = Path(runner(["go", "env", "GOROOT"], cwd=root))
    sources = [("MeRGBW Controller", root / "LICENSE"), ("Go standard library/runtime", go_license_path(goroot))]
    for module, version in sorted(modules):
        directory = Path(runner(["go", "list", "-m", "-f", "{{.Dir}}", module], cwd=root))
        candidates = [directory / name for name in ("LICENSE", "LICENSE.txt", "LICENSE.md", "COPYING")]
        source = next((path for path in candidates if path.is_file()), None)
        if not source:
            raise BuildError("linked dependency license is unavailable")
        sources.append((f"{module} {version}", source))
    result = ["Go and native dependency licenses; generated from linked build metadata."]
    for label, source in sources:
        no_symlinks(source)
        result.extend((f"\n===== {label} =====\n", source.read_text()))
    return "\n".join(result) + "\n"


def file_metadata(path):
    no_symlinks(path)
    if not path.is_file():
        raise BuildError("required slice file is missing")
    return {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "mode": f"{path.stat().st_mode & 0o7777:04o}"}


def build_slice(output_root, *, root=ROOT, runner=run, system=None, machine=None):
    arch, macho = native_host(system, machine)
    output_root = Path(output_root)
    no_symlinks(output_root)
    target = output_root / "plugin-native" / f"darwin_{arch}"
    if target.exists():
        raise BuildError("slice output already exists; refusing overwrite")
    metadata = provenance(root, runner)
    deps = runner(["go", "list", "-deps", "./cmd/sunset/supervisor"], cwd=root,
                  env={**os.environ, "GOOS": "darwin", "GOARCH": arch, "CGO_ENABLED": "0"})
    if any(value in deps for value in ("internal/ble", "tinygo.org/x/bluetooth", "tinygo-org/cbgo")):
        raise BuildError("supervisor dependency closure includes BLE")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".slice-", dir=target.parent) as temporary:
        staged = Path(temporary)
        env = {**os.environ, "GOOS": "darwin", "GOARCH": arch, "MACOSX_DEPLOYMENT_TARGET": "13.5"}
        supervisor, worker = staged / "mergbw-supervisor", staged / "sunset"
        runner(["go", "build", "-trimpath", "-ldflags=-macos=13.5.0", "-o", str(supervisor), "./cmd/sunset/supervisor"],
               cwd=root, env={**env, "CGO_ENABLED": "0"})
        runner(["go", "build", "-trimpath", "-o", str(worker), "./cmd/sunset"], cwd=root,
               env={**env, "CGO_ENABLED": "1", "CGO_CFLAGS": "-mmacosx-version-min=13.5",
                    "CGO_LDFLAGS": "-mmacosx-version-min=13.5"})
        for binary in (supervisor, worker):
            binary.chmod(0o755)
            inspect_binary(binary, macho, runner, root)
        notice = staged / "go-native-notices.txt"
        notice.write_text(notices((supervisor, worker), root, runner))
        notice.chmod(0o644)
        metadata.update(architecture=macho, files={path.name: file_metadata(path) for path in (supervisor, worker, notice)})
        (staged / "slice-manifest.json").write_text(json.dumps(metadata, indent=2) + "\n")
        (staged / "slice-manifest.json").chmod(0o644)
        target.mkdir()
        for path in staged.iterdir():
            shutil.move(str(path), target / path.name)
    return target


def inspect_slice(directory, architecture, expected, root, runner):
    directory = Path(directory)
    no_symlinks(directory)
    if not directory.is_dir() or {path.name for path in directory.iterdir()} != {"slice-manifest.json", "sunset", "mergbw-supervisor", "go-native-notices.txt"}:
        raise BuildError("slice directory has missing or unexpected files")
    manifest_path = directory / "slice-manifest.json"
    no_symlinks(manifest_path)
    if not manifest_path.is_file() or manifest_path.stat().st_size > 65536 or manifest_path.stat().st_mode & 0o7777 != 0o644:
        raise BuildError("slice manifest must be a bounded regular 0644 file")
    metadata = json.loads(manifest_path.read_text())
    if set(metadata) != set(expected) | {"architecture", "files"} or any(metadata.get(key) != value for key, value in expected.items()) or metadata.get("architecture") != architecture:
        raise BuildError("native slices do not match source/protocol/bridge/minimum metadata")
    if set(metadata["files"]) != {"sunset", "mergbw-supervisor", "go-native-notices.txt"}:
        raise BuildError("unexpected slice inventory")
    for name, entry in metadata["files"].items():
        path = directory / name
        if entry != file_metadata(path) or entry.get("mode") != ("0644" if name.endswith(".txt") else "0755"):
            raise BuildError("slice hash or archive mode is incompatible")
        if not name.endswith(".txt"):
            inspect_binary(path, architecture, runner, root)
    return directory


def assemble(output_root, arm64_dir, amd64_dir, *, root=ROOT, runner=run, system=None):
    native_host(system, "arm64")
    output_root = Path(output_root)
    no_symlinks(output_root)
    expected = provenance(root, runner)
    arm = inspect_slice(arm64_dir, "arm64", expected, root, runner)
    intel = inspect_slice(amd64_dir, "x86_64", expected, root, runner)
    if (arm / "go-native-notices.txt").read_bytes() != (intel / "go-native-notices.txt").read_bytes():
        raise BuildError("slice dependency notices do not match")
    target = output_root / PLUGIN
    if target.exists():
        raise BuildError("assembled output exists; refusing overwrite")
    output_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".assembly-", dir=output_root) as temporary:
        staged = Path(temporary) / PLUGIN
        for name in RUNTIME_FILES:
            copy_regular(root / "streamdeck" / PLUGIN / name, staged / name)
        contents = staged / APP
        template = root / "streamdeck/native/Info.plist"
        info = plistlib.loads(template.read_bytes())
        if info.get("CFBundleIdentifier") != "com.obalunenko.mergbw.controller" or info.get("CFBundleExecutable") != "mergbw-supervisor" or info.get("LSMinimumSystemVersion") != "13.5" or not info.get("NSBluetoothAlwaysUsageDescription"):
            raise BuildError("native privacy template is incompatible")
        copy_regular(template, contents / "Info.plist")
        for language in ("en", "ru"):
            copy_regular(root / f"streamdeck/native/{language}.lproj/InfoPlist.strings", contents / f"Resources/{language}.lproj/InfoPlist.strings")
        copy_regular(arm / "go-native-notices.txt", staged / "licenses/go-native-notices.txt")
        for name, destination in (("mergbw-supervisor", "MacOS/mergbw-supervisor"), ("sunset", "Helpers/sunset")):
            binary = contents / destination
            binary.parent.mkdir(parents=True, exist_ok=True)
            runner(["lipo", "-create", str(arm / name), str(intel / name), "-output", str(binary)], cwd=root)
            binary.chmod(0o755)
            inspect_binary(binary, "arm64 x86_64", runner, root)
        # Unsigned assembly has no runtime manifest and cannot pass the package gate.
        target.mkdir()
        for path in staged.iterdir():
            shutil.move(str(path), target / path.name)
        assembly = {**expected, "files": {name: file_metadata(target / APP / name)
                    for name in sorted(set(NATIVE_FILES) - {"_CodeSignature/CodeResources"})}}
        assembly["noticesSHA256"] = hashlib.sha256((target / "licenses/go-native-notices.txt").read_bytes()).hexdigest()
        (output_root / "assembly-manifest.json").write_text(json.dumps(assembly, indent=2) + "\n")
    return target


def finish_payload(target, mode, *, root=ROOT, runner=run, system=None, credentials=None):
    if mode not in ("development", "distribution"):
        raise BuildError("complete payload mode must be development or distribution")
    credentials = os.environ if credentials is None else credentials
    identity, profile = credentials.get("DEVELOPER_ID_APPLICATION"), credentials.get("NOTARY_KEYCHAIN_PROFILE")
    if mode == "distribution" and (not identity or not identity.startswith("Developer ID Application:") or not profile):
        raise BuildError("distribution signing/notarization credentials are required")
    native_host(system, "arm64")
    target = Path(target)
    no_symlinks(target)
    metadata = provenance(root, runner)
    if mode == "distribution" and runner(["git", "status", "--porcelain", "--untracked-files=normal"], cwd=root):
        raise BuildError("distribution requires clean tagged source")
    contents = target / APP
    assembly_path = target.parent / "assembly-manifest.json"
    no_symlinks(assembly_path)
    assembly = json.loads(assembly_path.read_text())
    if any(assembly.get(key) != value for key, value in metadata.items()):
        raise BuildError("assembled source provenance no longer matches")
    expected_assembly = set(NATIVE_FILES) - {"_CodeSignature/CodeResources"}
    if set(assembly.get("files", {})) != expected_assembly or any(
            file_metadata(contents / name) != entry for name, entry in assembly["files"].items()):
        raise BuildError("assembled bytes no longer match inspected slices")
    if hashlib.sha256((target / "licenses/go-native-notices.txt").read_bytes()).hexdigest() != assembly.get("noticesSHA256"):
        raise BuildError("assembled dependency notices changed")
    worker, supervisor = contents / "Helpers/sunset", contents / "MacOS/mergbw-supervisor"
    for binary in (worker, supervisor):
        inspect_binary(binary, "arm64 x86_64", runner, root)
    expected_before = set(NATIVE_FILES) - {"_CodeSignature/CodeResources"}
    # Re-signing is deliberately disallowed: assembly/signing is a one-way pipeline.
    actual_before = {path.relative_to(contents).as_posix() for path in contents.rglob("*") if path.is_file() or path.is_symlink()}
    if actual_before != expected_before:
        raise BuildError("unsigned bundle contains unexpected files")
    flags = ["--options", "runtime", "--timestamp"] if mode == "distribution" else []
    for path in (worker, contents.parent):
        runner(["codesign", "--force", "--sign", identity if mode == "distribution" else "-", *flags, str(path)], cwd=root)
    for path in (worker, contents.parent):
        runner(["codesign", "--verify", "--strict", "--all-architectures", str(path)], cwd=root)
    if mode == "distribution":
        # Apple-supported ZIP; never submit the third-party Elgato archive itself.
        with tempfile.TemporaryDirectory(prefix="mergbw-notarize-") as temporary:
            archive = str(Path(temporary) / "controller.zip")
            runner(["ditto", "-c", "-k", "--keepParent", str(contents.parent), archive], cwd=root)
            response = json.loads(runner(["xcrun", "notarytool", "submit", archive, "--keychain-profile", profile, "--wait", "--output-format", "json"], cwd=root))
            if response.get("status") != "Accepted":
                raise BuildError("notarization was not accepted")
        runner(["xcrun", "stapler", "staple", str(contents.parent)], cwd=root)
        runner(["xcrun", "stapler", "validate", str(contents.parent)], cwd=root)
        for path in (worker, contents.parent):
            runner(["codesign", "--verify", "--strict", "--all-architectures", str(path)], cwd=root)
    inventory = set(NATIVE_FILES) | ({"CodeResources"} if mode == "distribution" else set())
    actual = set()
    for path in contents.rglob("*"):
        no_symlinks(path)
        if path.is_file():
            actual.add(path.relative_to(contents).as_posix())
    if actual != inventory:
        raise BuildError("unexpected final signature/ticket inventory")
    entries = []
    for name in sorted(inventory):
        path = contents / name
        entry = file_metadata(path)
        if not path.stat().st_size or entry["mode"] != ("0755" if name in ("MacOS/mergbw-supervisor", "Helpers/sunset") else "0644"):
            raise BuildError("invalid final native file mode or empty signature/ticket")
        entries.append({"path": f"MeRGBW Controller.app/Contents/{name}", **entry})
    metadata.update(buildMode=mode, architectures=["arm64", "x86_64"], files=entries)
    manifest = target / "controller/payload-manifest.json"
    manifest.write_text(json.dumps(metadata, indent=2) + "\n")
    manifest.chmod(0o644)
    return target



def extract_slice(archive, output_root):
    """Validate a mode-preserving CI envelope before materializing any member."""
    archive, output_root = Path(archive), Path(output_root)
    no_symlinks(archive)
    no_symlinks(output_root)
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        roots = {member.name.split("/")[0] for member in members}
        if len(roots) != 1 or not roots <= {"darwin_arm64", "darwin_amd64"}:
            raise BuildError("unexpected native artifact root")
        name = roots.pop()
        inventory = {name, *(f"{name}/{file}" for file in ("slice-manifest.json", "sunset", "mergbw-supervisor", "go-native-notices.txt"))}
        if len(members) != len(inventory) or {member.name for member in members} != inventory:
            raise BuildError("native artifact inventory is missing, duplicate or unexpected")
        for member in members:
            mode = 0o755 if member.name == name or member.name.endswith(("/sunset", "/mergbw-supervisor")) else 0o644
            if (member.isdir() if member.name == name else member.isfile()) is not True or member.mode & 0o7777 != mode or member.size > 128 * 1024 * 1024:
                raise BuildError("native artifact type/mode is incompatible")
        target = output_root / name
        if target.exists():
            raise BuildError("native artifact destination already exists")
        output_root.mkdir(parents=True, exist_ok=True)
        target.mkdir(mode=0o755)
        for member in members:
            if member.isfile():
                path = output_root / member.name
                with bundle.extractfile(member) as source:
                    path.write_bytes(source.read())
                path.chmod(member.mode & 0o7777)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("spike", help="build current-Mac fixture without launching or linking")
    command.add_argument("--output-root", required=True, type=Path)
    command = commands.add_parser("build", help="compile/inspect the native host slice")
    command.add_argument("--output-root", type=Path, default=ROOT / "dist")
    command = commands.add_parser("assemble", help="assemble matching universal native roles")
    command.add_argument("--output-root", type=Path, default=ROOT / "dist/plugin-stage")
    command.add_argument("--arm64-dir", type=Path, default=ROOT / "dist/plugin-native/darwin_arm64")
    command.add_argument("--amd64-dir", type=Path, default=ROOT / "dist/plugin-native/darwin_amd64")
    command = commands.add_parser("extract-slice", help="validate and extract a mode-preserving CI slice envelope")
    command.add_argument("--archive", required=True, type=Path)
    command.add_argument("--output-root", type=Path, default=ROOT / "dist/plugin-native")
    for name in ("dev", "sign"):
        command = commands.add_parser(name, help="finalize explicit development/distribution payload")
        command.add_argument("--plugin-root", type=Path, default=ROOT / "dist/plugin-stage" / PLUGIN)
    args = parser.parse_args()
    try:
        if args.command == "spike":
            target = spike(args.output_root)
        elif args.command == "build":
            target = build_slice(args.output_root)
        elif args.command == "extract-slice":
            target = extract_slice(args.archive, args.output_root)
        elif args.command == "assemble":
            target = assemble(args.output_root, args.arm64_dir, args.amd64_dir)
        else:
            target = finish_payload(args.plugin_root, "development" if args.command == "dev" else "distribution")
    except (BuildError, OSError, ValueError, KeyError, TypeError) as exc:
        parser.exit(1, f"native payload failed: {exc}\n")
    print(f"Native payload prepared (not launched): {target}")

if __name__ == "__main__":
    main()
