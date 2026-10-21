#!/usr/bin/env python3
"""Package the built controller and generate complete, commit-based release notes."""

import argparse
import re
import subprocess
import tarfile
from pathlib import Path
from urllib.parse import quote


TAG = re.compile(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?")
GROUPS = {
    "feat": "Features",
    "fix": "Fixes",
    "perf": "Performance",
    "refactor": "Maintenance and CI",
    "build": "Maintenance and CI",
    "ci": "Maintenance and CI",
    "chore": "Maintenance and CI",
    "docs": "Documentation",
    "test": "Tests",
}
ARCHIVE_FILES = ("sunset", "README.md", "README_RU.md", "LICENSE")


def release_tag(value):
    if not TAG.fullmatch(value):
        raise argparse.ArgumentTypeError("expected vX.Y.Z or vX.Y.Z-prerelease")
    return value


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def previous_tag(tag):
    # Only consider valid release tags reachable from this release, including
    # tags on its commit. Unrelated branches and development tags are excluded.
    tags = git("tag", "--merged", tag, "--sort=-version:refname").splitlines()
    candidates = [candidate for candidate in tags if candidate != tag and TAG.fullmatch(candidate)]
    if not candidates:
        return None
    return git("describe", "--tags", "--abbrev=0", *[f"--match={candidate}" for candidate in candidates], tag)


def notes(tag, repository):
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repository):
        raise ValueError("repository must be owner/repo")
    git("rev-parse", "--verify", f"refs/tags/{tag}^{{commit}}")
    previous = previous_tag(tag)
    base = f"https://github.com/{repository}"
    encoded_tag = quote(tag, safe="")
    history = f"{previous}..{tag}" if previous else tag
    raw = git("log", "--reverse", "--no-merges", "--format=%H%x00%s%x00%b%x00%an%x00", history)
    fields = raw.split("\0")
    groups = {name: [] for name in ["Breaking changes", *dict.fromkeys(GROUPS.values()), "Other changes"]}
    for index in range(0, len(fields) - 1, 4):
        commit, subject, body, author = (field.strip() for field in fields[index:index + 4])
        conventional = re.match(r"(\w+)(?:\([^)]*\))?(!)?:\s", subject)
        group = GROUPS.get(conventional[1], "Other changes") if conventional else "Other changes"
        if (conventional and conventional[2]) or re.search(r"(?m)^BREAKING[ -]CHANGE:", body):
            group = "Breaking changes"
        entry = f"- {subject} ([{commit[:7]}]({base}/commit/{commit})) — {author}"
        if body:
            entry += "\n\n" + "\n".join(f"  > {line}" for line in body.splitlines())
        groups[group].append(entry)

    lines = [f"# MeRGBW {tag}", ""]
    if previous:
        lines += [f"Changes since [{previous}]({base}/releases/tag/{quote(previous, safe='')}).", ""]
    else:
        lines += ["First release: includes the complete project history.", ""]
    for group, entries in groups.items():
        if entries:
            lines += [f"## {group}", "", "\n\n".join(entries), ""]
    if not any(groups.values()):
        lines += ["No new commits since the previous tag.", ""]
    download = f"{base}/releases/download/{encoded_tag}"
    lines += ["## Downloads", "", "| Platform | Asset |", "| --- | --- |"]
    for platform, label in [("darwin_arm64", "macOS / Apple Silicon"), ("darwin_amd64", "macOS / Intel"),
                            ("linux_amd64", "Linux / x86-64"), ("linux_arm64", "Linux / ARM64")]:
        filename = f"sunset_{tag}_{platform}.tar.gz"
        lines.append(f"| {label} | [{filename}]({download}/{filename}) |")
    plugin = "com.obalunenko.mergbw.streamDeckPlugin"
    lines += [f"| Stream Deck / macOS | [{plugin}]({download}/{plugin}) |", "",
              f"Verify downloads using [SHA256SUMS]({download}/SHA256SUMS) (`shasum -a 256 -c SHA256SUMS` on macOS; `sha256sum -c SHA256SUMS` on Linux).", "",
              "Controller archives contain `sunset`, both READMEs and the MIT license. Extract the archive, then initialize and start the controller:", "",
              "```sh", "./sunset --identity AA:BB:CC:DD:EE:FF init", "./sunset serve", "```", "",
              "Replace the example identity with your lamp's manufacturer-data identity. Existing settings and presets are preserved. On macOS, allow Bluetooth for the terminal launching the controller. Linux requires BlueZ/D-Bus and a Bluetooth adapter.", "",
              "Open the `.streamDeckPlugin` installer on macOS with Stream Deck 7.1+ (macOS 13.5+); it requires the running controller. Import a private controller URL in the plugin inspector.", "",
              "CI validates software and builds native binaries without operating a lamp. Device compatibility and physical effects are described in the bundled READMEs.", ""]
    changelog = f"{base}/compare/{quote(previous, safe='')}...{encoded_tag}" if previous else f"{base}/commits/{encoded_tag}"
    lines += [f"[Full changelog]({changelog})", ""]
    return "\n".join(lines)


def archive(tag, go):
    platform = subprocess.check_output([go, "env", "GOOS", "GOARCH"], text=True).split()
    if len(platform) != 2 or platform[0] not in ("darwin", "linux") or platform[1] not in ("amd64", "arm64"):
        raise ValueError("release archives support macOS/Linux on amd64/arm64")
    # Explicit allowlist: never package settings, tokens, URLs or local presets.
    for name in ARCHIVE_FILES:
        if not Path(name).is_file() or Path(name).is_symlink():
            raise ValueError(f"missing or symlinked release file: {name}")
    output = Path("dist") / f"sunset_{tag}_{'_'.join(platform)}.tar.gz"
    output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(output, "w:gz") as bundle:
        for name in ARCHIVE_FILES:
            bundle.add(name, arcname=name)
    print(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    packaging = commands.add_parser("archive")
    packaging.add_argument("--tag", type=release_tag, required=True)
    packaging.add_argument("--go", default="go")
    changelog = commands.add_parser("notes")
    changelog.add_argument("--tag", type=release_tag, required=True)
    changelog.add_argument("--repository", required=True)
    changelog.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "archive":
        archive(args.tag, args.go)
    else:
        text = notes(args.tag, args.repository)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
