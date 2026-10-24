"""Exercise release ranges and packaging with local fixtures, without BLE."""

import argparse
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

import release


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="mergbw-release-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.addCleanup(os.chdir, Path.cwd())
        os.chdir(self.directory)
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Release Test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "tag.gpgsign", "false")
        self.commit("feat: initial controller")

    def git(self, *arguments):
        return subprocess.check_output(["git", *arguments], text=True, stderr=subprocess.PIPE).strip()

    def commit(self, subject, body=None):
        arguments = ["commit", "--allow-empty", "-m", subject]
        if body:
            arguments += ["-m", body]
        self.git(*arguments)
        return self.git("rev-parse", "HEAD")

    def test_first_release_contains_history_bodies_and_downloads(self):
        commit = self.commit("fix: retry connection", "Preserve cancellation.\n\nDo not repeat uncertain writes.")
        self.git("tag", "v1.0.0")
        notes = release.notes("v1.0.0", "example/controller")
        for expected in ["First release", "## Features", "## Fixes", "initial controller",
                         "Preserve cancellation.", "Do not repeat uncertain writes.",
                         f"/commit/{commit}", "/commits/v1.0.0", "SHA256SUMS", ".streamDeckPlugin"]:
            self.assertIn(expected, notes)
        for platform in ("darwin_arm64", "darwin_amd64", "linux_amd64", "linux_arm64"):
            self.assertIn(f"sunset_v1.0.0_{platform}.tar.gz", notes)

    def test_bundled_setup_import_upgrade_and_standalone_instructions_are_distinct(self):
        self.git("tag", "v1.0.0")
        notes = release.notes("v1.0.0", "example/controller")
        for expected in ("both Apple Silicon and Intel", "no separate controller, Terminal", "runtime executable download",
                         "stop any old standalone server", "never terminates foreign processes",
                         "settings.json and optional presets.json", "Source files remain unchanged",
                         "Application Support", "assignments, custom artwork and language",
                         "profile contains assignments without credentials", "needs local setup",
                         "For standalone CLI use", "./sunset serve", "permission",
                         "Local installation is sufficient for acceptance",
                         "without Developer ID, notarization or an Apple certificate",
                         "com.obalunenko.mergbw.development.streamDeckPlugin"):
            self.assertIn(expected, notes)
        self.assertNotIn("it requires the running controller", notes)
        self.assertNotIn("Import a private controller URL", notes)
        self.assertEqual(notes.count(".tar.gz]"), 4)

    def test_incremental_release_excludes_old_and_unrelated_history(self):
        self.git("tag", "-a", "v1.0.0", "-m", "First")
        self.git("switch", "-c", "unrelated")
        self.commit("feat: unrelated feature")
        self.git("tag", "v9.0.0")
        self.git("switch", "main")
        self.commit("fix: recover connection")
        self.git("tag", "v-next")
        self.commit("docs: explain recovery")
        self.git("tag", "v1.1.0")
        notes = release.notes("v1.1.0", "example/controller")
        self.assertIn("recover connection", notes)
        self.assertIn("explain recovery", notes)
        self.assertIn("/compare/v1.0.0...v1.1.0", notes)
        self.assertNotIn("initial controller", notes)
        self.assertNotIn("unrelated feature", notes)

    def test_prerelease_uses_nearest_release_and_highlights_breaking_changes(self):
        self.git("tag", "v1.0.0")
        self.commit("feat: earlier change")
        self.git("tag", "v1.1.0-rc.1")
        self.commit("feat(api)!: change routes", "BREAKING CHANGE: regenerate URLs.")
        self.commit("Unclassified direct commit")
        self.git("tag", "v1.1.0-rc.2")
        notes = release.notes("v1.1.0-rc.2", "example/controller")
        self.assertIn("/compare/v1.1.0-rc.1...v1.1.0-rc.2", notes)
        self.assertIn("## Breaking changes", notes)
        self.assertIn("regenerate URLs", notes)
        self.assertIn("## Other changes", notes)
        self.assertIn("Unclassified direct commit", notes)
        self.assertNotIn("earlier change", notes)

    def test_two_tags_on_one_commit_have_no_new_commits(self):
        self.git("tag", "v1.0.0")
        self.git("tag", "v1.0.1")
        self.assertIn("No new commits", release.notes("v1.0.1", "example/controller"))

    def test_archive_preserves_executable_and_excludes_local_secrets(self):
        for name in release.ARCHIVE_FILES:
            Path(name).write_text("release fixture", encoding="utf-8")
        Path("sunset").chmod(0o755)
        for name in ("settings.json", "presets.json", "streamdeck-buttons.txt", ".env"):
            Path(name).write_text("private value", encoding="utf-8")
        fake_go = self.directory / "fake-go"
        fake_go.write_text("#!/bin/sh\nprintf 'darwin\\narm64\\n'\n", encoding="utf-8")
        fake_go.chmod(0o755)
        release.archive("v1.0.0", str(fake_go))
        with tarfile.open("dist/sunset_v1.0.0_darwin_arm64.tar.gz") as bundle:
            self.assertEqual(bundle.getnames(), list(release.ARCHIVE_FILES))
            self.assertEqual(bundle.getmember("sunset").mode & 0o111, 0o111)
        Path("README.md").unlink()
        Path("README.md").symlink_to("settings.json")
        with self.assertRaisesRegex(ValueError, "symlinked"):
            release.archive("v1.0.0", str(fake_go))

    def test_rejects_invalid_tags_and_repository(self):
        for tag in ("v1.0.0", "v2.1.3-rc.1"):
            self.assertEqual(release.release_tag(tag), tag)
        for tag in ("v-next", "v01.2.3", "1.0.0", "v1.0.0/../../secret"):
            with self.assertRaises(argparse.ArgumentTypeError):
                release.release_tag(tag)
        with self.assertRaises(ValueError):
            release.notes("v1.0.0", "../../private")


if __name__ == "__main__":
    unittest.main()
