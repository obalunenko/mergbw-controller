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
        installed = shutil.which("task")
        self.task = [installed] if installed else [
            "go", "tool", f"-modfile={REPOSITORY / 'tools/task/go.mod'}", "task"
        ]

    def run_task(self, *arguments, environment=None):
        self.events.unlink(missing_ok=True)
        result = subprocess.run(
            [*self.task, "--taskfile", str(self.project / "Taskfile.yml"),
             f"GO={self.go}", *arguments],
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

    def test_check_excludes_hardware_and_local_tooling(self):
        result, events = self.run_task("--dry", "check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("hardware", result.stderr)
        self.assertNotIn("speckit", result.stderr)
        self.assertNotIn("workflows:test", result.stderr)
        self.assertEqual(events, [])


if __name__ == "__main__":
    unittest.main()
