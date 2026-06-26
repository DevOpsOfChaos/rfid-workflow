from __future__ import annotations

import argparse
from dataclasses import dataclass
from fnmatch import fnmatch
from pathlib import Path
import re
import subprocess
import sys


FORBIDDEN_GLOBS = (
    "*.bin",
    "*.bundle",
    "*.dump",
    "*.eml",
    "*.gif",
    "*.jpeg",
    "*.jpg",
    "*.key",
    "*.log",
    "*.mp4",
    "*.png",
    "*.zip",
    "*.webp",
    ".env",
    ".env.*",
)
FORBIDDEN_DIRS = (
    ".git",
    ".idea",
    ".venv",
    ".venv-gui",
    ".vscode",
    "__pycache__",
    "templates",
    "backups",
    "build",
    "dist",
    "artifacts",
    "audit",
    "logs",
    "private",
    "private_fixtures",
    "release",
    "runtime",
    "scratch",
    "tmp",
    "local-data",
)
SECRET_PATTERNS = (
    re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?[A-Za-z0-9_\-./+=]{12,}"),
    re.compile(r"(?i)-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
)
LOCAL_PATH_PATTERNS = (
    re.compile(r"(?i)\b[A-Z]:\\(?:Users|LocalRepos|Repos|ProxSpace)\\"),
    re.compile(r"(?i)/(?:Users|home)/[^/\s]+/"),
)
TEXT_EXTENSIONS = {
    ".css",
    ".html",
    ".js",
    ".json",
    ".md",
    ".ps1",
    ".py",
    ".toml",
    ".txt",
    ".yaml",
    ".yml",
}


@dataclass(frozen=True)
class Finding:
    path: str
    reason: str


@dataclass(frozen=True)
class AuditFile:
    rel: str
    path: Path | None = None
    text: str | None = None

    @property
    def name(self) -> str:
        return Path(self.rel).name

    @property
    def suffix(self) -> str:
        return Path(self.rel).suffix


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit a public export for private RFID data and local files.")
    parser.add_argument("path", nargs="?", default=".", help="Repository or staging directory to audit.")
    parser.add_argument("--export-list", help="Backward-compatible alias for --expected-files.")
    parser.add_argument("--expected-files", help="Text file with the intended export paths, one relative path per line.")
    parser.add_argument(
        "--private-patterns",
        default=".public-audit-private-patterns.txt",
        help="Backward-compatible alias for --denylist.",
    )
    parser.add_argument("--denylist", help="Local private denylist file. It must stay untracked.")
    parser.add_argument("--tracked", action="store_true", help="Audit git tracked files under the target path.")
    parser.add_argument("--staged-only", action="store_true", help="Audit files staged in git only.")
    parser.add_argument("--git-ref", help="Audit file contents from a git ref without modifying the worktree.")
    args = parser.parse_args(argv)

    try:
        root = Path(args.path).resolve()
        if not root.exists():
            print(f"Audit target does not exist: {root}", file=sys.stderr)
            return 2
        findings = audit(root, args)
    except Exception as exc:
        print(f"Audit failed: {exc}", file=sys.stderr)
        return 2

    if findings:
        for finding in findings:
            print(f"{finding.path}: {finding.reason}")
        return 1
    print("No public export audit findings.")
    return 0


def audit(root: Path, args: argparse.Namespace) -> list[Finding]:
    denylist_arg = getattr(args, "denylist", None) or getattr(args, "private_patterns", None)
    expected_arg = getattr(args, "expected_files", None) or getattr(args, "export_list", None)
    mode_count = sum(
        bool(value)
        for value in (
            getattr(args, "git_ref", None),
            getattr(args, "staged_only", False),
            getattr(args, "tracked", False),
        )
    )
    if mode_count > 1:
        raise ValueError("--git-ref, --staged-only, and --tracked are mutually exclusive")

    private_patterns = _load_private_patterns(_resolve_sidecar_path(root, denylist_arg))
    files = _candidate_files(root, args)
    findings = _expected_file_findings(files, root, expected_arg)

    for file in sorted(files, key=lambda item: item.rel):
        findings.extend(_path_findings(file))
        text = _file_text(file)
        if text is not None:
            findings.extend(_content_findings(file.rel, text, private_patterns))
    return findings


def _candidate_files(root: Path, args: argparse.Namespace) -> list[AuditFile]:
    git_ref = getattr(args, "git_ref", None)
    if git_ref:
        return _git_ref_files(root, git_ref)
    if getattr(args, "staged_only", False):
        return _git_list_files(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMRT"])
    if getattr(args, "tracked", False):
        return _git_list_files(root, ["ls-files"])
    return [
        AuditFile(_as_posix(path.relative_to(root)), path=path)
        for path in root.rglob("*")
        if path.is_file()
    ]


def _git_ref_files(root: Path, git_ref: str) -> list[AuditFile]:
    completed = _git(root, ["ls-tree", "-r", "--name-only", git_ref])
    files: list[AuditFile] = []
    for line in completed.stdout.splitlines():
        rel = line.strip()
        if not rel:
            continue
        text = None
        if Path(rel).suffix.lower() in TEXT_EXTENSIONS:
            shown = _git(root, ["show", f"{git_ref}:{rel}"], check=False, encoding="utf-8")
            if shown.returncode == 0:
                text = shown.stdout
        files.append(AuditFile(_as_posix(Path(rel)), path=root / rel, text=text))
    return files


def _git_list_files(root: Path, git_args: list[str]) -> list[AuditFile]:
    completed = _git(root, git_args)
    return [
        AuditFile(_as_posix(Path(line.strip())), path=root / line.strip())
        for line in completed.stdout.splitlines()
        if line.strip()
    ]


def _expected_file_findings(files: list[AuditFile], root: Path, expected_files: str | None) -> list[Finding]:
    if not expected_files:
        return []
    expected_path = _resolve_sidecar_path(root, expected_files)
    expected = _load_expected_files(expected_path)
    actual = {file.rel for file in files}
    findings = [Finding(path, "expected file is missing from audit input") for path in sorted(expected - actual)]
    findings.extend(Finding(path, "file is not listed in expected export file") for path in sorted(actual - expected))
    return findings


def _load_expected_files(path: Path) -> set[str]:
    if not path.exists():
        raise ValueError(f"expected files list does not exist: {path}")
    result: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if Path(stripped).is_absolute():
            raise ValueError(f"expected file paths must be relative: {stripped}")
        result.add(_as_posix(Path(stripped)))
    if not result:
        raise ValueError(f"expected files list is empty: {path}")
    return result


def _path_findings(file: AuditFile) -> list[Finding]:
    normalized = file.rel
    findings = []
    if any(fnmatch(file.name, pattern) for pattern in FORBIDDEN_GLOBS):
        findings.append(Finding(file.rel, "forbidden file type or environment file"))
    parts = set(normalized.split("/")[:-1])
    forbidden = sorted(parts.intersection(FORBIDDEN_DIRS))
    if forbidden:
        findings.append(Finding(file.rel, f"forbidden runtime/private directory: {', '.join(forbidden)}"))
    if _looks_like_media_or_dump(file):
        findings.append(Finding(file.rel, "screenshots, media, dumps, or binary artifacts require explicit review"))
    return findings


def _content_findings(rel: str, text: str, private_patterns: tuple[str, ...]) -> list[Finding]:
    findings: list[Finding] = []
    for pattern in SECRET_PATTERNS:
        if pattern.search(text):
            findings.append(Finding(rel, "possible secret"))
            break
    for pattern in LOCAL_PATH_PATTERNS:
        if pattern.search(text):
            findings.append(Finding(rel, "local user or repository path"))
            break
    lowered = text.lower()
    for private in private_patterns:
        if private.lower() in lowered:
            findings.append(Finding(rel, "private denylist pattern"))
            break
    return findings


def _load_private_patterns(path: Path) -> tuple[str, ...]:
    if not path.exists():
        return ()
    text = path.read_text(encoding="utf-8", errors="replace")
    if "\ufffd" in text:
        raise ValueError(f"denylist file is not valid UTF-8: {path}")
    patterns = tuple(
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    )
    if path.stat().st_size and not patterns:
        raise ValueError(f"denylist file contains no usable patterns: {path}")
    return patterns


def _file_text(file: AuditFile) -> str | None:
    if file.text is not None:
        return file.text
    if file.path is None or not file.path.is_file() or not _is_text_like(file.path):
        return None
    try:
        return file.path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def _is_text_like(path: Path) -> bool:
    if path.stat().st_size > 5_000_000:
        return False
    try:
        with path.open("rb") as handle:
            sample = handle.read(2048)
    except OSError:
        return False
    return b"\0" not in sample


def _looks_like_media_or_dump(file: AuditFile) -> bool:
    return file.suffix.lower() in {
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".mp4",
        ".mov",
        ".pcap",
        ".trace",
        ".dump",
    }


def _resolve_sidecar_path(root: Path, value: str | None) -> Path:
    raw = Path(value or ".public-audit-private-patterns.txt")
    return raw if raw.is_absolute() else root / raw


def _git(root: Path, args: list[str], check: bool = True, encoding: str | None = None) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        capture_output=True,
        text=True,
        encoding=encoding,
        errors="replace",
    )
    if check and completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or f"git {' '.join(args)} failed")
    return completed


def _as_posix(path: Path) -> str:
    return path.as_posix().strip("/")


if __name__ == "__main__":
    raise SystemExit(main())
