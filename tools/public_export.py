from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from fnmatch import fnmatch
import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

from tools.public_repo_audit import Finding, _content_findings, _file_text, _path_findings, _as_posix, AuditFile


DEFAULT_EXCLUDES = (
    ".git/",
    ".venv/",
    ".venv-gui/",
    "runtime/",
    "local-data/",
    "templates/",
    "backups/",
    "artifacts/",
    "audit/",
    "logs/",
    "private/",
    "tests/private_fixtures/",
    "release/",
    "scratch/",
    "tmp/",
    "__pycache__/",
    ".vscode/",
    ".idea/",
    "*.bundle",
    "*.log",
    "*.bin",
    "*.cer",
    "*.crt",
    "*.der",
    "*.eml",
    "*.dump",
    "*.key",
    "*.mp4",
    "*.p12",
    "*.pem",
    "*.pfx",
    "*.zip",
    ".env",
    ".env.*",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.webp",
)


@dataclass(frozen=True)
class PublicExportManifest:
    includes: tuple[str, ...]
    excludes: tuple[str, ...]


@dataclass(frozen=True)
class PublicExportResult:
    stage_path: Path
    file_count: int
    hash_manifest_path: Path
    audit_exit_code: int


def prepare_public_export(
    repo_root: Path,
    output_path: Path,
    denylist_path: Path,
    manifest_path: Path,
    timestamp: str | None = None,
    enforce_local_repos: bool = True,
) -> PublicExportResult:
    repo_root = repo_root.resolve()
    output_path = output_path.resolve()
    denylist_path = _resolve(repo_root, denylist_path)
    manifest_path = _resolve(repo_root, manifest_path)
    if output_path.exists():
        raise RuntimeError(f"OutputPath already exists and will not be overwritten: {output_path}")
    if not denylist_path.exists():
        raise RuntimeError("Denylist is required for public export preparation")
    private_patterns = _load_required_denylist(denylist_path)
    manifest = load_public_export_manifest(manifest_path)
    stage_path = output_path.with_name(f"{output_path.name}-{timestamp or _timestamp()}")
    if stage_path.exists():
        raise RuntimeError(f"Timestamped staging path already exists: {stage_path}")
    if _is_relative_to(stage_path, repo_root):
        raise RuntimeError("Export staging path must not be inside the private working repository")
    if enforce_local_repos and not _is_under_local_repos(stage_path):
        raise RuntimeError(f"Export staging path must be under D:\\LocalRepos: {stage_path}")

    included_files = _manifest_files(repo_root, manifest, apply_excludes=False)
    source_findings = _source_findings(included_files, private_patterns, manifest, repo_root)
    if source_findings:
        raise PublicExportBlocked(source_findings)
    candidates = [file for file in included_files if not _excluded(file.rel, manifest.excludes)]
    if not candidates:
        raise RuntimeError("Public export manifest selected no exportable files")

    stage_path.mkdir(parents=True)
    try:
        for source in candidates:
            rel_path = Path(source.rel)
            target = stage_path / rel_path
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source.path, target)

        expected_files = stage_path.parent / f"{stage_path.name}.expected-files.txt"
        expected_files.write_text("\n".join(sorted(file.rel for file in candidates)) + "\n", encoding="utf-8")
        audit_command = [
            sys.executable,
            str(repo_root / "tools" / "public_repo_audit.py"),
            str(stage_path),
            "--denylist",
            str(denylist_path),
            "--expected-files",
            str(expected_files),
        ]
        audit = subprocess.run(audit_command, check=False, capture_output=True, text=True)
        expected_files.unlink(missing_ok=True)
        if audit.returncode != 0:
            (stage_path / "_PUBLIC_EXPORT_FAILED.txt").write_text(
                "Public export audit failed. This staging directory is not publishable.\n"
                + audit.stdout
                + audit.stderr,
                encoding="utf-8",
            )
            raise RuntimeError((audit.stdout + audit.stderr).strip() or "public export audit failed")

        hash_manifest_path = stage_path / "_public_export_sha256_manifest.txt"
        _write_hash_manifest(stage_path, hash_manifest_path)
        return PublicExportResult(stage_path, len(candidates), hash_manifest_path, audit.returncode)
    except Exception:
        if "expected_files" in locals():
            expected_files.unlink(missing_ok=True)
        if stage_path.exists():
            failed = stage_path / "_PUBLIC_EXPORT_FAILED.txt"
            if not failed.exists():
                failed.write_text("Public export preparation failed. This staging directory is not publishable.\n", encoding="utf-8")
        raise


class PublicExportBlocked(RuntimeError):
    def __init__(self, findings: list[Finding]) -> None:
        self.findings = findings
        super().__init__(f"Public export blocked by {len(findings)} finding(s)")


def load_public_export_manifest(path: Path) -> PublicExportManifest:
    if not path.exists():
        raise RuntimeError(f"Public export manifest does not exist: {path}")
    includes: list[str] = []
    excludes: list[str] = []
    section = "include"
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        lowered = line.lower()
        if lowered in {"[include]", "include:"}:
            section = "include"
            continue
        if lowered in {"[exclude]", "exclude:"}:
            section = "exclude"
            continue
        _validate_manifest_entry(line)
        if section == "include":
            includes.append(_normalize_manifest_entry(line))
        else:
            excludes.append(_normalize_manifest_entry(line))
    if not includes:
        raise RuntimeError(f"Public export manifest contains no include entries: {path}")
    return PublicExportManifest(tuple(includes), tuple(excludes or DEFAULT_EXCLUDES))


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Prepare an audited public source export without private Git history.")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--output-path", required=True)
    parser.add_argument("--denylist-path", required=True)
    parser.add_argument("--manifest-path", required=True)
    args = parser.parse_args(argv)

    try:
        result = prepare_public_export(
            Path(args.repo_root),
            Path(args.output_path),
            Path(args.denylist_path),
            Path(args.manifest_path),
        )
    except PublicExportBlocked as exc:
        print(f"Public export blocked by {len(exc.findings)} finding(s).", file=sys.stderr)
        for finding in exc.findings:
            print(f"{finding.path}: {finding.reason}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Public export failed: {exc}", file=sys.stderr)
        return 1

    print(f"Staging path: {result.stage_path}")
    print(f"File count: {result.file_count}")
    print(f"SHA-256 manifest: {result.hash_manifest_path}")
    print("Audit result: passed")
    return 0


def _manifest_files(repo_root: Path, manifest: PublicExportManifest, apply_excludes: bool = True) -> list[AuditFile]:
    files: dict[str, AuditFile] = {}
    for entry in manifest.includes:
        source = repo_root / entry.rstrip("/")
        if any(char in entry for char in "*?[]"):
            matches = [path for path in repo_root.rglob("*") if path.is_file() and fnmatch(_as_posix(path.relative_to(repo_root)), entry)]
        elif entry.endswith("/"):
            matches = [path for path in source.rglob("*") if path.is_file()] if source.exists() else []
        elif source.exists() and source.is_file():
            matches = [source]
        elif source.exists() and source.is_dir():
            matches = [path for path in source.rglob("*") if path.is_file()]
        else:
            matches = []
        for path in matches:
            rel = _as_posix(path.relative_to(repo_root))
            if apply_excludes and _excluded(rel, manifest.excludes):
                continue
            files[rel] = AuditFile(rel, path=path)
    if not files:
        raise RuntimeError("Public export manifest selected no files")
    return [files[key] for key in sorted(files)]


def _source_findings(
    files: list[AuditFile],
    private_patterns: tuple[str, ...],
    manifest: PublicExportManifest,
    repo_root: Path,
) -> list[Finding]:
    findings: list[Finding] = []
    for file in files:
        if _excluded(file.rel, manifest.excludes):
            if _is_hard_blocked_export_source(file):
                findings.extend(_path_findings(file))
            continue
        if file.path and _as_posix(file.path.relative_to(repo_root)) != file.rel:
            findings.append(Finding(file.rel, "source path escaped repository root"))
        findings.extend(_path_findings(file))
        text = _file_text(file)
        if text is not None:
            findings.extend(_content_findings(file.rel, text, private_patterns))
    for file in files:
        if not _included(file.rel, manifest.includes):
            findings.append(Finding(file.rel, "file is outside public export manifest"))
    return findings


def _is_hard_blocked_export_source(file: AuditFile) -> bool:
    name = file.name.lower()
    suffix = file.suffix.lower()
    return name == ".env" or name.startswith(".env.") or suffix in {
        ".bin",
        ".cer",
        ".crt",
        ".der",
        ".dump",
        ".eml",
        ".gif",
        ".jpeg",
        ".jpg",
        ".key",
        ".log",
        ".mp4",
        ".p12",
        ".pem",
        ".pfx",
        ".png",
        ".zip",
        ".webp",
        ".bundle",
    }


def _write_hash_manifest(stage_path: Path, output: Path) -> None:
    lines: list[str] = []
    for path in sorted(p for p in stage_path.rglob("*") if p.is_file() and p != output):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        lines.append(f"{digest}  {_as_posix(path.relative_to(stage_path))}")
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _load_required_denylist(path: Path) -> tuple[str, ...]:
    text = path.read_text(encoding="utf-8", errors="replace")
    if "\ufffd" in text:
        raise RuntimeError(f"Denylist is not valid UTF-8: {path}")
    patterns = tuple(line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#"))
    if not patterns:
        raise RuntimeError(f"Denylist contains no usable patterns: {path}")
    return patterns


def _included(rel: str, includes: tuple[str, ...]) -> bool:
    return any(_matches_manifest_entry(rel, entry) for entry in includes)


def _excluded(rel: str, excludes: tuple[str, ...]) -> bool:
    return any(_matches_manifest_entry(rel, entry) for entry in excludes)


def _matches_manifest_entry(rel: str, entry: str) -> bool:
    normalized = _normalize_manifest_entry(entry)
    if normalized.endswith("/"):
        return rel.startswith(normalized) or f"/{normalized}" in rel
    return rel == normalized or fnmatch(rel, normalized)


def _validate_manifest_entry(entry: str) -> None:
    if Path(entry).is_absolute() or ".." in Path(entry).parts:
        raise RuntimeError(f"Manifest paths must be relative and stay inside the repository: {entry}")


def _normalize_manifest_entry(entry: str) -> str:
    return entry.replace("\\", "/").lstrip("/")


def _resolve(root: Path, value: Path) -> Path:
    return value.resolve() if value.is_absolute() else (root / value).resolve()


def _timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def _is_under_local_repos(path: Path) -> bool:
    parts = path.resolve().parts
    return len(parts) >= 2 and parts[0].upper().startswith("D:") and len(parts) >= 2 and parts[1].lower() == "localrepos"


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


if __name__ == "__main__":
    raise SystemExit(main())
