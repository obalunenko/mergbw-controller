"""Exercise the real Taskfile with recording executables, without native BLE."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


REPOSITORY = Path(__file__).resolve().parent.parent


class TaskWorkflowsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="mergbw-workflows-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.project = self.directory / "project with ' quotes $"
        self.project.mkdir()
        shutil.copyfile(REPOSITORY / "Taskfile.yml", self.project / "Taskfile.yml")
        self.events = self.directory / "events.jsonl"
        self.go = self.directory / "fake-go"
        self.cli = self.directory / "fake-sunset"
        self.go.write_text(
            "#!/usr/bin/env python3\n"
            "import json,os,pathlib,shutil,sys\n"
            "with open(os.environ['WORKFLOW_EVENTS'],'a') as f: "
            "f.write(json.dumps(['go',sys.argv[1:]])+'\\n')\n"
            "if sys.argv[1]=='build':\n"
            " shutil.copyfile(os.environ['WORKFLOW_CLI'],'sunset')\n"
            " pathlib.Path('sunset').chmod(0o700)\n"
            "if sys.argv[1]=='test':\n"
            " assert os.environ['MERGBW_DATA_DIR']==os.environ['WORKFLOW_EXPECTED_DATA']\n"
        )
        self.cli.write_text(
            "#!/usr/bin/env python3\n"
            "import json,os,sys\n"
            "with open(os.environ['WORKFLOW_EVENTS'],'a') as f: "
            "f.write(json.dumps(['sunset',sys.argv[1:]])+'\\n')\n"
            "sys.exit(int(os.environ.get('WORKFLOW_CLI_EXIT','0')))\n"
        )
        self.go.chmod(0o700)
        self.cli.chmod(0o700)
        self.environment = dict(os.environ)
        for key in ("CI", "MERGBW_DATA_DIR", "DATA_DIR", "GO", "WORKFLOW_CLI_EXIT"):
            self.environment.pop(key, None)
        self.environment.update(WORKFLOW_EVENTS=str(self.events), WORKFLOW_CLI=str(self.cli))
        plugin = self.project / "streamdeck"
        plugin.mkdir()
        executables = self.directory / "executables"
        executables.mkdir()
        for name in ("npm", "node", "python"):
            # The Python recorder represents build/fixture commands, never native executables.
            recorder = executables / name
            recorder.write_text(
                "#!/usr/bin/env python3\n"
                "import json,os,sys\n"
                "from pathlib import Path\n"
                "name=Path(sys.argv[0]).name\n"
                "if name=='npm' and sys.argv[1:] in (['run','check:package'],['run','package']) and os.environ.get('WORKFLOW_MODE_FILE'):\n"
                " with open(os.environ['WORKFLOW_MODE_FILE'],'a') as f: f.write(str(os.environ.get('PACKAGE_MODE'))+'\\n')\n"
                "with open(os.environ['WORKFLOW_EVENTS'],'a') as f: "
                "f.write(json.dumps([name,sys.argv[1:],os.getcwd()])+'\\n')\n"
                "sys.exit(29 if name=='npm' and ' '.join(sys.argv[1:])==os.environ.get('WORKFLOW_NPM_FAIL') else 0)\n"
            )
            recorder.chmod(0o700)
        self.python = executables / "python"
        self.environment["PATH"] = str(executables) + os.pathsep + self.environment["PATH"]
        installed = shutil.which("task")
        self.task = [installed] if installed else [
            "go", "tool", f"-modfile={REPOSITORY / 'tools/task/go.mod'}", "task"
        ]

    def run_task(self, *arguments, environment=None):
        self.events.unlink(missing_ok=True)
        result = subprocess.run(
            [*self.task, "--taskfile", str(self.project / "Taskfile.yml"),
             f"GO={self.go}", f"PYTHON={self.python}", *arguments],
            env=self.environment | (environment or {}),
            capture_output=True, text=True, timeout=20, check=False,
        )
        events = [json.loads(line) for line in self.events.read_text().splitlines()] \
            if self.events.exists() else []
        return result, events

    def test_setup_downloads_then_builds_then_initializes(self):
        result, events = self.run_task("setup", "--", "--identity", "AA:BB:CC:DD:EE:FF")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(events[0], ["go", ["mod", "download"]])
        self.assertEqual(events[1][1][0], "build")
        self.assertEqual(events[2], ["sunset", [
            "--data-dir", str(self.project), "--identity", "AA:BB:CC:DD:EE:FF", "init"
        ]])
        self.assertEqual(len(events), 3)

    def test_runtime_tasks_forward_commands_and_data_directory(self):
        data = str(self.directory / "data with ' quotes $HOME")
        for name, arguments, expected in [
            ("init", ["--identity", "AA:BB:CC:DD:EE:FF"], ["--identity", "AA:BB:CC:DD:EE:FF", "init"]),
            ("run", [], ["serve"]), ("serve", [], ["serve"]),
            ("urls", [], ["urls"]), ("inspect", [], ["inspect"]),
            ("send", ["color", "FF5000"], ["send", "color", "FF5000"]),
            ("dry-run", ["preset", "sunset"], ["dry-run", "preset", "sunset"]),
            ("version", [], ["--version"]),
        ]:
            with self.subTest(task=name):
                result, events = self.run_task(name, "--", *arguments,
                                               environment={"MERGBW_DATA_DIR": data})
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(events[0][1][0], "build")
                self.assertEqual(events[1], ["sunset", expected if name == "version" else
                                             ["--data-dir", data, *expected]])
                self.assertEqual(len(events), 2)

    def test_explicit_data_dir_overrides_environment(self):
        result, events = self.run_task("urls", "DATA_DIR=/explicit/data",
                                       environment={"MERGBW_DATA_DIR": "/environment/data"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(events[-1], ["sunset", ["--data-dir", "/explicit/data", "urls"]])

    def test_cli_arguments_preserve_spaces_and_quotes(self):
        data = str(self.directory / "CLI data with ' quotes $HOME")
        result, events = self.run_task("init", "--", "--data-dir", data,
                                      "--identity", "AA:BB:CC:DD:EE:FF")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(events[-1], ["sunset", [
            "--data-dir", str(self.project), "--data-dir", data,
            "--identity", "AA:BB:CC:DD:EE:FF", "init"
        ]])

    def test_hardware_defaults_to_project_configuration(self):
        for name in ("settings.json", "presets.json"):
            (self.project / name).write_text("{}")
        result, events = self.run_task("test:hardware", environment={
            "WORKFLOW_EXPECTED_DATA": str(self.project)
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(events, [["go", [
            "test", "-count=1", "-tags=hardware", "-timeout=15m", "-v", "./internal/ble/native"
        ]]])

    def test_hardware_rejects_ci_before_running_go(self):
        result, events = self.run_task("test:hardware", environment={"CI": "true"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("only locally", result.stderr)
        self.assertEqual(events, [])

    def test_hardware_requires_existing_configuration(self):
        result, events = self.run_task("test:hardware")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("settings.json and presets.json", result.stderr)
        self.assertEqual(events, [])

    def test_command_failures_reach_the_caller(self):
        result, events = self.run_task("run", environment={"WORKFLOW_CLI_EXIT": "23"})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(events[-1][0], "sunset")

    def test_core_suites_include_ble_free_independent_supervisor(self):
        for task in ("test:core", "test:race"):
            with self.subTest(task=task):
                result, events = self.run_task("--dry", task)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("./cmd/sunset/supervisor", result.stderr)
                self.assertNotIn("./cmd/sunset ", result.stderr)
                self.assertNotIn("./internal/ble/native", result.stderr)
                self.assertNotIn("hardware", result.stderr)
                self.assertEqual(events, [])

    def test_check_excludes_hardware_and_local_tooling(self):
        result, events = self.run_task("--dry", "check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("hardware", result.stderr)
        self.assertNotIn("speckit", result.stderr)
        self.assertNotIn("workflows:test", result.stderr)
        self.assertEqual(events, [])


    def plugin_events(self, commands):
        return [["npm", command.split(), str((self.project / "streamdeck").resolve())] for command in commands]

    def test_plugin_commands_run_in_package_directory(self):
        for task, commands in {
            "deps": ["ci"], "lint": ["run lint", "run format:check"],
            "typecheck": ["run typecheck"], "test": ["test"],
            "build": ["run build"], "validate": ["run validate"],
            "link": ["run check:package", "run link"], "watch": ["run check:package", "run watch"],
        }.items():
            with self.subTest(task=task):
                result, events = self.run_task("plugin:" + task)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(events, self.plugin_events(commands))

    def plugin_check_events(self, package=False, software=False):
        checks = ["run lint", "run format:check", "run typecheck", "test", "run build", "run validate", "run check:package:software"]
        events = self.plugin_events(checks)
        events.append(["python", ["../scripts/test_plugin_native.py"], str((self.project / "streamdeck").resolve())])
        if not software:
            events += self.plugin_events(["run check:package"])
        if package:
            events += self.plugin_events(["run package"])
        return events

    def test_plugin_check_and_package_are_ordered_without_host_effects(self):
        for task in ("check:software", "check", "package"):
            result, events = self.run_task("plugin:" + task)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(events, self.plugin_check_events(package=task == "package", software=task == "check:software"))
            self.assertNotIn("sunset", result.stderr)
            self.assertNotIn("hardware", result.stderr)
            self.assertNotIn("speckit", result.stderr)
            self.assertFalse(any("link" in event[1] or "watch" in event[1] for event in events))

    def test_plugin_failure_stops_later_stages(self):
        expected = self.plugin_check_events(package=True)
        for command in [event[1] for event in expected if event[0] == "npm"]:
            with self.subTest(stage=command):
                result, events = self.run_task("plugin:package", environment={"WORKFLOW_NPM_FAIL": " ".join(command)})
                self.assertNotEqual(result.returncode, 0)
                index = next(i for i, event in enumerate(expected) if event[0] == "npm" and event[1] == command)
                self.assertEqual(events, expected[:index + 1])

    def test_native_tasks_forward_only_build_input_overrides(self):
        arm = str(self.directory / "arm with ' quotes $HOME")
        intel = str(self.directory / "intel with ' quotes $HOME")
        for task, args in {
            "build": ["build", "--output-root", str(self.project / "dist")],
            "assemble": ["assemble", "--arm64-dir", arm, "--amd64-dir", intel],
            "dev": ["dev"], "sign": ["sign"],
        }.items():
            result, events = self.run_task("plugin:native:" + task, f"NATIVE_ARM64_DIR={arm}", f"NATIVE_AMD64_DIR={intel}")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(events, [["python", ["scripts/plugin-native.py", *args], str(self.project.resolve())]])
        for mode in ("distribution", "development"):
            mode_file = self.directory / f"{mode}.txt"
            result, events = self.run_task("plugin:package", f"PACKAGE_MODE={mode}", environment={"WORKFLOW_MODE_FILE": str(mode_file)})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(mode_file.read_text().splitlines())
            self.assertEqual(set(mode_file.read_text().splitlines()), {mode})
        mode_file = self.directory / "default-mode.txt"
        result, _ = self.run_task("plugin:package", environment={"WORKFLOW_MODE_FILE": str(mode_file)})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(set(mode_file.read_text().splitlines()), {"development"})

    def test_plugin_mock_forwards_literal_arguments_without_install_or_launch(self):
        value = "catalog with ' quotes $HOME"
        result, events = self.run_task("plugin:mock", "--", "--catalog", value)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(events, [["node", ["scripts/mock-bridge.mjs", "--catalog", value],
                                   str((self.project / "streamdeck").resolve())]])


if __name__ == "__main__":
    unittest.main()
