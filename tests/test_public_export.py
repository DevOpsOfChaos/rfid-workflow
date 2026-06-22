from pathlib import Path
import subprocess

import pytest

from tools.public_export import PublicExportBlocked, prepare_public_export


def _repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "README.md").write_text("public\n", encoding="utf-8")
    (repo / "pyproject.toml").write_text("[project]\nname = 'x'\n", encoding="utf-8")
    (repo / "src").mkdir()
    (repo / "src" / "app.py").write_text("print('ok')\n", encoding="utf-8")
    (repo / "tools").mkdir()
    (repo / "tools" / "public_repo_audit.py").write_text(
        "import sys\nprint('No public export audit findings.')\nsys.exit(0)\n",
        encoding="utf-8",
    )
    (repo / "manifest.txt").write_text("[include]\nREADME.md\npyproject.toml\nsrc/\n[exclude]\n.git/\n*.png\n*.log\n.env\n", encoding="utf-8")
    (repo / "deny.txt").write_text("PRIVATE_MARKER\n", encoding="utf-8")
    return repo


def test_clean_minimal_export_works_and_writes_hash_manifest(tmp_path):
    repo = _repo(tmp_path)

    result = prepare_public_export(
        repo,
        tmp_path / "public-candidate",
        repo / "deny.txt",
        repo / "manifest.txt",
        timestamp="20260101-000000",
        enforce_local_repos=False,
    )

    assert result.file_count == 3
    assert (result.stage_path / "README.md").exists()
    assert result.hash_manifest_path.exists()
    assert "README.md" in result.hash_manifest_path.read_text(encoding="utf-8")


def test_output_folder_existing_aborts_without_modifying_it(tmp_path):
    repo = _repo(tmp_path)
    output = tmp_path / "public-candidate"
    output.mkdir()
    marker = output / "keep.txt"
    marker.write_text("keep", encoding="utf-8")

    with pytest.raises(RuntimeError, match="already exists"):
        prepare_public_export(repo, output, repo / "deny.txt", repo / "manifest.txt", enforce_local_repos=False)

    assert marker.read_text(encoding="utf-8") == "keep"


def test_git_directory_is_never_copied(tmp_path):
    repo = _repo(tmp_path)
    (repo / ".git").mkdir()
    (repo / ".git" / "config").write_text("private", encoding="utf-8")

    result = prepare_public_export(
        repo,
        tmp_path / "public-candidate",
        repo / "deny.txt",
        repo / "manifest.txt",
        timestamp="20260101-000001",
        enforce_local_repos=False,
    )

    assert not (result.stage_path / ".git").exists()


def test_forbidden_extension_blocks_export(tmp_path):
    repo = _repo(tmp_path)
    (repo / "src" / "debug.log").write_text("debug", encoding="utf-8")

    with pytest.raises(PublicExportBlocked) as exc:
        prepare_public_export(repo, tmp_path / "public-candidate", repo / "deny.txt", repo / "manifest.txt", enforce_local_repos=False)

    assert any(finding.path == "src/debug.log" for finding in exc.value.findings)


def test_private_denylist_match_blocks_export(tmp_path):
    repo = _repo(tmp_path)
    (repo / "src" / "app.py").write_text("PRIVATE_MARKER\n", encoding="utf-8")

    with pytest.raises(PublicExportBlocked) as exc:
        prepare_public_export(repo, tmp_path / "public-candidate", repo / "deny.txt", repo / "manifest.txt", enforce_local_repos=False)

    assert any(finding.reason == "private denylist pattern" for finding in exc.value.findings)


def test_local_windows_path_blocks_export(tmp_path):
    repo = _repo(tmp_path)
    (repo / "src" / "app.py").write_text(r"path = 'D:\LocalRepos\RFID-GUI'", encoding="utf-8")

    with pytest.raises(PublicExportBlocked) as exc:
        prepare_public_export(repo, tmp_path / "public-candidate", repo / "deny.txt", repo / "manifest.txt", enforce_local_repos=False)

    assert any(finding.reason == "local user or repository path" for finding in exc.value.findings)


def test_screenshot_file_blocks_export(tmp_path):
    repo = _repo(tmp_path)
    (repo / "src" / "screen.png").write_bytes(b"\x89PNG\r\n")

    with pytest.raises(PublicExportBlocked) as exc:
        prepare_public_export(repo, tmp_path / "public-candidate", repo / "deny.txt", repo / "manifest.txt", enforce_local_repos=False)

    assert any("screenshots" in finding.reason for finding in exc.value.findings)


def test_manifest_outside_file_is_not_exported(tmp_path):
    repo = _repo(tmp_path)
    (repo / "private.txt").write_text("must stay out", encoding="utf-8")

    result = prepare_public_export(
        repo,
        tmp_path / "public-candidate",
        repo / "deny.txt",
        repo / "manifest.txt",
        timestamp="20260101-000002",
        enforce_local_repos=False,
    )

    assert not (result.stage_path / "private.txt").exists()


def test_missing_denylist_aborts(tmp_path):
    repo = _repo(tmp_path)

    with pytest.raises(RuntimeError, match="Denylist is required"):
        prepare_public_export(repo, tmp_path / "public-candidate", repo / "missing.txt", repo / "manifest.txt", enforce_local_repos=False)


def test_script_contains_no_push_git_init_or_remote_add():
    script = Path("scripts/prepare-public-export.ps1").read_text(encoding="utf-8").lower()
    core = Path("tools/public_export.py").read_text(encoding="utf-8").lower()
    text = script + "\n" + core

    assert "git push" not in text
    assert "git init" not in text
    assert "git remote add" not in text
