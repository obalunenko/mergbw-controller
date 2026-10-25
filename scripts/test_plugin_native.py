"""BLE-free fixtures for the standalone early native builder."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import tarfile
import unittest

# Upstream Go BSD license, kept in the fixture so Linux needs no host Go layout.
GO_LICENSE = """Copyright 2009 The Go Authors.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google LLC nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
"""

SPEC = importlib.util.spec_from_file_location("plugin_native", Path(__file__).with_name("plugin-native.py"))
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)

class Runner:
    def __init__(self):
        self.calls = []
        self.arch = "arm64"
        self.minimum = "13.5"
        self.dependencies = "runtime\nfixture/internal/managed"
        self.goroot = None
        self.tags = None

    def __call__(self, command, *, cwd, env=None):
        self.calls.append((command, env))
        if command[:3] == ["git", "rev-parse", "HEAD"]:
            return "a" * 40
        if command[:2] == ["git", "tag"]:
            if self.tags is None:
                raise native.BuildError("native build/inspection failed: git")
            return self.tags
        if command[:2] == ["git", "ls-files"]:
            return "internal/bridge/http.go\ngo.mod"
        if command[:2] == ["go", "build"]:
            Path(command[command.index("-o") + 1]).write_bytes(b"synthetic Mach-O; not executable")
            return ""
        if command == ["go", "env", "GOROOT"]:
            return str(self.goroot or Path(cwd) / "goroot")
        if command[:3] == ["go", "version", "-m"]:
            return "fixture: go1.27\n\tpath\tfixture\n"
        if command[:3] == ["go", "list", "-deps"]:
            return self.dependencies
        if command[:2] == ["git", "status"]:
            return ""
        if command[:2] == ["lipo", "-create"]:
            Path(command[command.index("-output") + 1]).write_bytes(b"synthetic universal")
            self.arch = "arm64 x86_64"
            return ""
        if command[:2] == ["lipo", "-archs"]:
            return ("arm64" if "darwin_arm64" in command[-1] else "x86_64" if "darwin_amd64" in command[-1] else self.arch)
        if command[:2] == ["otool", "-L"]:
            return "synthetic:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)"
        if command[:2] == ["otool", "-l"]:
            return f"Load command 1\n cmd LC_BUILD_VERSION\n platform 1\n minos {self.minimum}\n sdk 26.0\nLoad command 2\n cmd LC_LOAD_DYLIB\n current version 999.1"
        if command[0] == "codesign":
            if command[1] == "--force" and command[-1].endswith(".app"):
                signature = Path(command[-1]) / "Contents/_CodeSignature/CodeResources"
                signature.parent.mkdir(exist_ok=True)
                signature.write_bytes(b"synthetic ad-hoc resources")
            return ""
        if command[:3] == ["xcrun", "notarytool", "submit"]:
            return '{"status":"Accepted"}'
        if command[:3] == ["xcrun", "stapler", "staple"]:
            (Path(command[-1]) / "Contents/CodeResources").write_bytes(b"synthetic ticket")
            return ""
        if command[:3] == ["xcrun", "stapler", "validate"] or command[0] == "ditto":
            return ""
        raise AssertionError(f"Unexpected execution: {command}")

class GoLicenseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name).resolve()

    def test_standard_goroot_keeps_its_own_upstream_license(self):
        goroot = self.directory / "go"
        goroot.mkdir()
        license_path = goroot / "LICENSE"
        license_path.write_text(GO_LICENSE)
        self.assertEqual(native.go_license_path(goroot), license_path)

    def test_homebrew_libexec_parent_license_is_included_without_native_invocation(self):
        goroot = self.directory / "Cellar/go/1.27.3/libexec"
        goroot.mkdir(parents=True)
        license_path = goroot.parent / "LICENSE"
        license_path.write_text(GO_LICENSE)
        (self.directory / "LICENSE").write_text("Copyright synthetic project")
        runner = Runner()
        runner.goroot = goroot
        notices = native.notices([self.directory / "synthetic-worker"], self.directory, runner)
        self.assertEqual(native.go_license_path(goroot), license_path)
        self.assertIn(GO_LICENSE, notices)
        self.assertEqual([command[:2] for command, _ in runner.calls], [["go", "version"], ["go", "env"]])

    def test_unrelated_parent_or_incompatible_primary_does_not_supply_go_license(self):
        for name in ("ordinary-goroot", "libexec"):
            with self.subTest(layout=name):
                goroot = self.directory / name
                goroot.mkdir()
                (self.directory / "LICENSE").write_text("Unrelated MIT license")
                with self.assertRaises(native.BuildError):
                    native.go_license_path(goroot)
        # A valid parent cannot hide an incompatible primary license.
        (self.directory / "LICENSE").write_text(GO_LICENSE)
        (self.directory / "libexec/LICENSE").write_text("Unrelated MIT license")
        with self.assertRaisesRegex(native.BuildError, "identity"):
            native.go_license_path(self.directory / "libexec")
        with self.assertRaisesRegex(native.BuildError, "unavailable"):
            native.go_license_path(self.directory / "ordinary-goroot")

    def test_homebrew_fallback_rejects_symlink_license(self):
        goroot = self.directory / "libexec"
        goroot.mkdir()
        source = self.directory / "upstream-license"
        source.write_text(GO_LICENSE)
        (self.directory / "LICENSE").symlink_to(source)
        with self.assertRaisesRegex(native.BuildError, "symlink"):
            native.go_license_path(goroot)


class SpikeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve() / "repo"
        self.output = Path(self.temporary.name).resolve() / "isolated"
        self.source = self.root / "streamdeck" / native.PLUGIN
        for name in native.RUNTIME_FILES:
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("built fixture")
        self.manifest = self.source / "manifest.json"
        self.manifest.write_text(json.dumps({"UUID": "com.obalunenko.mergbw", "Version": "0.2.0.0", "Name": "MeRGBW"}, indent=4) + "\n")
        shutil.copytree(native.ROOT / "streamdeck/native", self.root / "streamdeck/native")
        bridge = self.root / "internal/bridge/http.go"
        bridge.parent.mkdir(parents=True)
        bridge.write_text('package bridge\nconst Version = "2.0.0-go"\n')
        (self.root / "LICENSE").write_text("Copyright fixture license")
        (self.root / "goroot").mkdir()
        (self.root / "goroot/LICENSE").write_text(GO_LICENSE)
        (self.root / "go.mod").write_text("module fixture\ngo 1.27\n")
        self.runner = Runner()

    def build(self, **kwargs):
        return native.spike(self.output, root=self.root, runner=self.runner, system="Darwin", machine="arm64", **kwargs)

    def test_allowlisted_staging_and_exact_metadata_without_execution(self):
        (self.source / "settings.json").write_text("secret fixture")
        (self.source / "private.log").write_text("private fixture")
        target = self.build()
        metadata = json.loads((target / "controller/payload-manifest.json").read_text())
        self.assertEqual(metadata["buildMode"], "spike")
        self.assertEqual(metadata["architectures"], ["arm64"])
        self.assertEqual(metadata["minimumMacOS"], "13.5")
        self.assertEqual(metadata["sourceRevision"], "a" * 40)
        self.assertEqual(metadata["managedProtocolVersion"], 1)
        self.assertEqual(metadata["bridgeVersion"], "2.0.0-go")
        self.assertRegex(metadata["sourceTreeSHA256"], r"^[0-9a-f]{64}$")
        expected = set(native.RUNTIME_FILES) | {f"{native.APP}/{name}" for name in native.NATIVE_FILES} | {"controller/payload-manifest.json", "licenses/go-native-notices.txt", "release.json"}
        self.assertEqual({path.relative_to(target).as_posix() for path in target.rglob("*") if path.is_file()}, expected)
        notice = target / "licenses/go-native-notices.txt"
        self.assertIn("Copyright fixture license", notice.read_text())
        self.assertIn(GO_LICENSE, notice.read_text())
        self.assertEqual(stat.S_IMODE(notice.stat().st_mode), 0o644)
        for entry in metadata["files"]:
            path = target / "controller" / entry["path"]
            self.assertEqual(entry["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(entry["mode"], f"{stat.S_IMODE(path.stat().st_mode):04o}")
        self.assertNotIn(str(self.root), json.dumps(metadata))
        self.assertNotIn("secret fixture", json.dumps(metadata))
        builds = [(command, env) for command, env in self.runner.calls if command[:2] == ["go", "build"]]
        self.assertEqual(len(builds), 2)
        self.assertEqual(builds[0][1]["CGO_ENABLED"], "0")
        self.assertIn("-ldflags=-macos=13.5.0", builds[0][0])
        self.assertEqual(builds[1][1]["CGO_ENABLED"], "1")
        self.assertEqual(builds[1][1]["MACOSX_DEPLOYMENT_TARGET"], "13.5")
        self.assertEqual(json.loads((target / "release.json").read_text()), {"tag": "v0.2.0", "build": 1})
        self.assertEqual(json.loads((target / "manifest.json").read_text())["Version"], "0.2.0.1")
        self.assertTrue(all(command[0] in ("go", "git", "lipo", "otool", "codesign") for command, _ in self.runner.calls))
        self.assertTrue(all(command[0] not in ("sunset", "mergbw-supervisor", "open", "streamdeck") for command, _ in self.runner.calls))

    def test_refuses_overwrite_before_any_build(self):
        self.output.mkdir()
        (self.output / native.PLUGIN).mkdir()
        with self.assertRaisesRegex(native.BuildError, "overwrite"):
            self.build()
        self.assertEqual(self.runner.calls, [])

    def test_requires_absolute_output(self):
        with self.assertRaisesRegex(native.BuildError, "absolute"):
            native.spike(Path("relative"), root=self.root, runner=self.runner, system="Darwin", machine="arm64")
        self.assertEqual(self.runner.calls, [])

    def test_rejects_non_mac_and_unsupported_architecture(self):
        for system, machine in (("Linux", "arm64"), ("Darwin", "mips")):
            with self.assertRaises(native.BuildError):
                native.spike(self.output, root=self.root, runner=self.runner, system=system, machine=machine)
        self.assertEqual(self.runner.calls, [])

    def test_rejects_symlink_assets_and_output_parents(self):
        asset = self.source / "bin/plugin.js"
        asset.unlink()
        asset.symlink_to(self.source / "manifest.json")
        with self.assertRaisesRegex(native.BuildError, "symlink"):
            self.build()
        self.output.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(native.BuildError, "symlink"):
            self.build()

    def test_requires_built_js_without_creating_output(self):
        (self.source / "ui/inspector.js").unlink()
        with self.assertRaisesRegex(native.BuildError, "JS build"):
            self.build()
        self.assertFalse(self.output.exists())

    def test_rejects_wrong_architecture_or_actual_macho_minimum(self):
        for attribute, value in (("arch", "x86_64"), ("minimum", "13.0")):
            runner = Runner()
            setattr(runner, attribute, value)
            with self.assertRaises(native.BuildError):
                native.spike(self.output, root=self.root, runner=runner, system="Darwin", machine="arm64")
            self.assertFalse((self.output / native.PLUGIN).exists())

    def test_full_package_allowlist_rejects_spike(self):
        # This imports the existing checker; it executes no native binary.
        code = f'import assert from "node:assert/strict"; import {{validateEntries}} from {json.dumps((native.ROOT / "streamdeck/scripts/check-package.mjs").as_uri())}; assert.throws(()=>validateEntries(["{native.PLUGIN}/controller/payload-manifest.json"]),/missing distribution file/);'
        subprocess.run([shutil.which("node"), "--input-type=module", "-e", code], check=True)


class CompleteTests(SpikeTests):
    def slices(self):
        outputs = []
        for machine in ("arm64", "x86_64"):
            runner = Runner()
            runner.arch = machine
            outputs.append(native.build_slice(self.output, root=self.root, runner=runner,
                                              system="Darwin", machine=machine))
        return outputs

    def assemble(self, slices, **kwargs):
        return native.assemble(self.output, *slices, root=self.root, runner=self.runner, system="Darwin", **kwargs)

    def stamp(self, target):
        return json.loads((target / "manifest.json").read_text())["Version"], json.loads((target / "release.json").read_text())

    def test_release_tag_stamps_staged_manifest_and_release_json_without_counter(self):
        source = self.manifest.read_bytes()
        slices = self.slices()
        for tag in ("v1.3.0", "v1.3.0-rc.1"):
            with self.subTest(tag=tag):
                target = self.assemble(slices, release_tag=tag)
                self.assertEqual(self.stamp(target), ("1.3.0.0", {"tag": tag, "build": 0}))
                self.assertEqual(stat.S_IMODE((target / "release.json").stat().st_mode), 0o644)
                self.assertEqual(json.loads((target / "manifest.json").read_text())["Name"], "MeRGBW")
                shutil.rmtree(target)
        self.assertFalse((self.root / "dist/plugin-build-number").exists())
        self.assertFalse(any(command[:2] == ["git", "tag"] for command, _ in self.runner.calls))
        self.assertEqual(self.manifest.read_bytes(), source)

    def test_invalid_release_tag_fails_before_staging(self):
        slices = self.slices()
        for tag in ("1.3.0", "v1.3", "v01.3.0", "v1.3.0-", "v1.3.0+build", "v1.3.0\n", ""):
            with self.subTest(tag=tag), self.assertRaisesRegex(native.BuildError, "release tag"):
                self.assemble(slices, release_tag=tag)
        self.assertEqual(self.runner.calls, [])
        self.assertFalse((self.output / native.PLUGIN).exists())

    def test_local_build_uses_nearest_tag_and_atomic_counter(self):
        source = self.manifest.read_bytes()
        slices = self.slices()
        # Same-commit and out-of-order tags: the highest semver wins, not the first listed.
        self.runner.tags = "v0.1.0\nv1.2.0-rc.1\nv1.2.0\nv1.10.0-rc.1\nv1.9.0\nnext"
        for build in (1, 2):
            target = self.assemble(slices)
            self.assertEqual(self.stamp(target), (f"1.10.0.{build}", {"tag": "v1.10.0-rc.1", "build": build}))
            self.assertEqual((self.root / "dist/plugin-build-number").read_text().strip(), str(build))
            shutil.rmtree(target)
        listed = [command for command, _ in self.runner.calls if command[:2] == ["git", "tag"]]
        self.assertEqual(listed[0], ["git", "tag", "--merged", "HEAD", "--list", "v*"])
        self.assertEqual(sorted(path.name for path in (self.root / "dist").iterdir()), ["plugin-build-number"])
        self.assertEqual(self.manifest.read_bytes(), source)

    def test_local_build_without_valid_tag_falls_back_to_source_manifest(self):
        slices = self.slices()
        for tags in (None, "", "vnext\nv1.2"):
            with self.subTest(tags=tags):
                shutil.rmtree(self.root / "dist", ignore_errors=True)
                self.runner.tags = tags
                target = self.assemble(slices)
                self.assertEqual(self.stamp(target), ("0.2.0.1", {"tag": "v0.2.0", "build": 1}))
                shutil.rmtree(target)

    def test_invalid_counter_or_source_version_fails_without_output(self):
        slices = self.slices()
        (self.root / "dist").mkdir()
        (self.root / "dist/plugin-build-number").write_text("seven")
        with self.assertRaisesRegex(native.BuildError, "counter"):
            self.assemble(slices)
        (self.root / "dist/plugin-build-number").unlink()
        self.manifest.write_text(json.dumps({"Version": "0.2.0"}))
        with self.assertRaisesRegex(native.BuildError, "manifest version"):
            self.assemble(slices)
        self.assertFalse((self.output / native.PLUGIN).exists())

    def test_native_slices_are_inspected_not_invoked_and_do_not_replace_cli_archives(self):
        self.output.mkdir()
        archive = self.output / "sunset_v1_darwin_arm64.tar.gz"
        archive.write_bytes(b"standalone archive")
        for directory in self.slices():
            metadata = json.loads((directory / "slice-manifest.json").read_text())
            self.assertEqual(metadata["minimumMacOS"], "13.5")
            self.assertEqual(metadata["managedProtocolVersion"], 1)
            self.assertEqual(set(metadata["files"]), {"sunset", "mergbw-supervisor", "go-native-notices.txt"})
        self.assertEqual(archive.read_bytes(), b"standalone archive")

    def test_assembly_requires_both_roles_from_same_source_and_rejects_tampering(self):
        slices = self.slices()
        manifest = slices[1] / "slice-manifest.json"
        original = manifest.read_bytes()
        for field, value in (("sourceRevision", "b" * 40), ("sourceTreeSHA256", "c" * 64),
                             ("managedProtocolVersion", 2), ("bridgeVersion", "foreign")):
            metadata = json.loads(original)
            metadata[field] = value
            manifest.write_text(json.dumps(metadata))
            with self.assertRaises(native.BuildError):
                self.assemble(slices)
        manifest.write_bytes(original)
        (slices[1] / "sunset").unlink()
        with self.assertRaises(native.BuildError):
            self.assemble(slices)

    def test_slice_manifest_symlink_mode_and_supervisor_ble_dependency_are_rejected(self):
        slices = self.slices()
        manifest = slices[0] / "slice-manifest.json"
        manifest.chmod(0o755)
        with self.assertRaisesRegex(native.BuildError, "manifest"):
            self.assemble(slices)
        manifest.chmod(0o644)
        other = self.root / "synthetic-manifest.json"
        manifest.rename(other)
        manifest.symlink_to(other)
        with self.assertRaisesRegex(native.BuildError, "symlink"):
            self.assemble(slices)
        runner = Runner()
        runner.dependencies = "fixture/internal/ble"
        with self.assertRaisesRegex(native.BuildError, "BLE"):
            native.build_slice(self.root / "other-output", root=self.root, runner=runner, system="Darwin", machine="arm64")
        self.assertFalse(any(command[:2] == ["go", "build"] for command, _ in runner.calls))

    def test_native_artifact_envelope_preserves_modes_and_rejects_mode_loss_before_extraction(self):
        directory = self.slices()[0]
        archive = self.output / "native.tar.gz"
        with tarfile.open(archive, "w:gz") as bundle:
            bundle.add(directory, arcname=directory.name)
        extracted = native.extract_slice(archive, self.output / "downloaded")
        self.assertEqual(native.file_metadata(extracted / "sunset"), native.file_metadata(directory / "sunset"))
        (directory / "sunset").chmod(0o644)
        with tarfile.open(archive, "w:gz") as bundle:
            bundle.add(directory, arcname=directory.name)
        rejected = self.output / "rejected"
        with self.assertRaisesRegex(native.BuildError, "mode"):
            native.extract_slice(archive, rejected)
        self.assertFalse(rejected.exists())

    def test_complete_development_requires_universal_worker_and_supervisor(self):
        target = self.assemble(self.slices())
        native.finish_payload(target, "development", root=self.root, runner=self.runner, system="Darwin")
        metadata = json.loads((target / "controller/payload-manifest.json").read_text())
        self.assertEqual(metadata["buildMode"], "development")
        self.assertEqual(metadata["architectures"], ["arm64", "x86_64"])
        for entry in metadata["files"]:
            path = target / "controller" / entry["path"]
            self.assertEqual(entry["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(entry["mode"], f"{stat.S_IMODE(path.stat().st_mode):04o}")
        self.assertFalse(any(command[0] in ("sunset", "mergbw-supervisor", "open") for command, _ in self.runner.calls))
        self.assertEqual(self.stamp(target), ("0.2.0.1", {"tag": "v0.2.0", "build": 1}))

    def test_finish_rejects_missing_or_disagreeing_release_stamp(self):
        for fault in ("missing", "keys", "version"):
            with self.subTest(fault=fault):
                shutil.rmtree(self.output, ignore_errors=True)
                target = self.assemble(self.slices(), release_tag="v1.3.0")
                stamp = target / "release.json"
                if fault == "missing":
                    stamp.unlink()
                if fault == "keys":
                    stamp.write_text(json.dumps({"tag": "v1.3.0", "build": 0, "extra": 1}))
                if fault == "version":
                    stamp.write_text(json.dumps({"tag": "v1.4.0", "build": 0}))
                with self.assertRaisesRegex(native.BuildError, "release stamp"):
                    native.finish_payload(target, "development", root=self.root, runner=self.runner, system="Darwin")
                self.assertFalse((target / "controller/payload-manifest.json").exists())

    def test_distribution_missing_credentials_fails_before_signing_without_downgrade(self):
        target = self.assemble(self.slices())
        before = len(self.runner.calls)
        with self.assertRaisesRegex(native.BuildError, "credentials"):
            native.finish_payload(target, "distribution", root=self.root, runner=self.runner,
                                  system="Darwin", credentials={})
        self.assertEqual(len(self.runner.calls), before)
        self.assertFalse((target / "controller/payload-manifest.json").exists())

    def test_distribution_signs_inner_then_outer_and_rehashes_after_stapling(self):
        target = self.assemble(self.slices())
        native.finish_payload(target, "distribution", root=self.root, runner=self.runner, system="Darwin",
                              credentials={"DEVELOPER_ID_APPLICATION": "Developer ID Application: Fixture",
                                           "NOTARY_KEYCHAIN_PROFILE": "synthetic-profile"})
        calls = [command for command, _ in self.runner.calls]
        signatures = [command for command in calls if command[:2] == ["codesign", "--force"]]
        self.assertTrue(signatures[0][-1].endswith("Helpers/sunset"))
        self.assertTrue(signatures[1][-1].endswith(".app"))
        self.assertTrue(all("--timestamp" in command and "runtime" in command for command in signatures))
        self.assertLess(next(i for i, command in enumerate(calls) if command[:2] == ["lipo", "-create"]),
                        next(i for i, command in enumerate(calls) if command[0] == "codesign"))
        manifest = json.loads((target / "controller/payload-manifest.json").read_text())
        self.assertEqual(manifest["buildMode"], "distribution")
        ticket = next(entry for entry in manifest["files"] if entry["path"].endswith("Contents/CodeResources"))
        self.assertEqual(ticket["sha256"], hashlib.sha256(b"synthetic ticket").hexdigest())

if __name__ == "__main__":
    unittest.main()
