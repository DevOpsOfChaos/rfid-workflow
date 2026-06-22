from __future__ import annotations

import argparse
from dataclasses import dataclass
from fnmatch import fnmatch
import os
from pathlib import Path
import re
import subprocess
import sys


FORBIDDEN_GLOBS = (
    "*.bin",
    "*.eml",
    "*.dump",
    "*.key",
    "*.log",
    ".env",
    ".env.*",
)
FORBIDDEN_DIRS = (
    "templates",
    "backups",
    "audit",
    "logs",
    "runtime",
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


@dataclass(frozen=True)
class Finding:
    path: str
    reason: str


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit a staged public export for private RFID data and local files.")
    parser.add_argument("path", nargs="?", default=".", help="Repository or staging directory to audit.")
    parser.add_argument("--export-list", help="Optional text file with intended export paths, one per line.")
    parser.add_argument(
        "--private-patterns",
        default=".public-audit-private-patterns.txt",
        help="Local private denylist file. It must stay untracked.",
    )
    parser.add_argument("--tracked", action="store_true", help="Audit git tracked files under the target path.")
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
    files = _candidate_files(root, args.tracked)
    if args.export_list:
        files.extend(_export_list_files(root, Path(args.export_list)))
    files = sorted(set(files))
    private_patterns = _load_private_patterns(root / args.private_patterns)
    findings: list[Finding] = []
    for path in files:
        rel = _relative(path, root)
        findings.extend(_path_findings(rel, path))
        if path.is_file() and _is_text_like(path):
            findings.extend(_content_findings(rel, path, private_patterns))
    return findings


def _candidate_files(root: Path, tracked_only: bool) -> list[Path]:
    if tracked_only:
        completed = subprocess.run(
            ["git", "-C", str(root), "ls-files"],
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or "git ls-files failed")
        return [root / line.strip() for line in completed.stdout.splitlines() if line.strip()]
    return [path for path in root.rglob("*") if path.is_file() and ".git" not in path.parts]


def _export_list_files(root: Path, export_list: Path) -> list[Path]:
    base = export_list.resolve().parent
    result: list[Path] = []
    for line in export_list.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        candidate = Path(stripped)
        result.append(candidate if candidate.is_absolute() else (base / candidate if (base / candidate).exists() else root / candidate))
    return result


def _path_findings(rel: str, path: Path) -> list[Finding]:
    normalized = rel.replace("\\", "/")
    findings = []
    name = path.name
    if any(fnmatch(name, pattern) for pattern in FORBIDDEN_GLOBS):
        findings.append(Finding(rel, "forbidden file type or environment file"))
    parts = set(normalized.split("/")[:-1])
    forbidden = sorted(parts.intersection(FORBIDDEN_DIRS))
    if forbidden:
        findings.append(Finding(rel, f"forbidden runtime/private directory: {', '.join(forbidden)}"))
    if _looks_like_media_or_dump(path):
        findings.append(Finding(rel, "screenshots, media, dumps, or binary artifacts require explicit review"))
    return findings


def _content_findings(rel: str, path: Path, private_patterns: tuple[str, ...]) -> list[Finding]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return [Finding(rel, f"could not read file: {exc}")]
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
    return tuple(
        line.strip()
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    )


def _is_text_like(path: Path) -> bool:
    if path.stat().st_size > 5_000_000:
        return False
    try:
        with path.open("rb") as handle:
            sample = handle.read(2048)
    except OSError:
        return False
    return b"\0" not in sample


def _looks_like_media_or_dump(path: Path) -> bool:
    return path.suffix.lower() in {
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


def _relative(path: Path, root: Path) -> str:
    try:
        return str(path.resolve().relative_to(root))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    raise SystemExit(main())
