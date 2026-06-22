from __future__ import annotations

from argparse import Namespace
import subprocess

from tools.public_repo_audit import audit, main


def test_public_audit_flags_forbidden_runtime_files(tmp_path):
    runtime = tmp_path / "templates"
    runtime.mkdir()
    (runtime / "chip.json").write_text("{}", encoding="utf-8")
    (tmp_path / "debug.log").write_text("debug", encoding="utf-8")

    findings = audit(tmp_path, Namespace(tracked=False, export_list=None, private_patterns="missing.txt"))

    reasons = " ".join(finding.reason for finding in findings)
    assert "forbidden runtime/private directory" in reasons
    assert "forbidden file type" in reasons


def test_public_audit_flags_private_fixture_dirs_and_archives(tmp_path):
    private_fixture = tmp_path / "tests" / "private_fixtures"
    private_fixture.mkdir(parents=True)
    (private_fixture / "sample.txt").write_text("private", encoding="utf-8")
    (tmp_path / "artifact.zip").write_bytes(b"PK\x03\x04")

    findings = audit(tmp_path, Namespace(tracked=False, export_list=None, private_patterns="missing.txt"))

    reasons = {(finding.path, finding.reason) for finding in findings}
    assert ("tests/private_fixtures/sample.txt", "forbidden runtime/private directory: private_fixtures") in reasons
    assert any(path == "artifact.zip" and "forbidden file type" in reason for path, reason in reasons)


def test_public_audit_flags_private_denylist_without_modifying_files(tmp_path):
    denylist = tmp_path / ".public-audit-private-patterns.txt"
    denylist.write_text("PRIVATE_TEST_PATTERN_123\n", encoding="utf-8")
    public_file = tmp_path / "README.md"
    public_file.write_text("contains PRIVATE_TEST_PATTERN_123", encoding="utf-8")
    before = public_file.read_text(encoding="utf-8")

    exit_code = main([str(tmp_path), "--private-patterns", ".public-audit-private-patterns.txt"])

    assert exit_code == 1
    assert public_file.read_text(encoding="utf-8") == before


def test_public_audit_git_ref_flags_committed_forbidden_file(tmp_path):
    _git(tmp_path, "init")
    (tmp_path / "README.md").write_text("public", encoding="utf-8")
    (tmp_path / "debug.log").write_text("debug", encoding="utf-8")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-m", "seed")

    exit_code = main([str(tmp_path), "--git-ref", "HEAD"])

    assert exit_code == 1


def test_public_audit_default_mode_ignores_git_metadata(tmp_path):
    _git(tmp_path, "init")
    (tmp_path / "README.md").write_text("public", encoding="utf-8")
    _git(tmp_path, "add", "README.md")
    _git(tmp_path, "commit", "-m", "seed")

    findings = audit(tmp_path, Namespace(staged_only=False, tracked=False, git_ref=None, expected_files=None, export_list=None, denylist=None, private_patterns="missing.txt"))

    assert findings == []


def test_public_audit_staged_only_ignores_unstaged_files(tmp_path):
    _git(tmp_path, "init")
    (tmp_path / "README.md").write_text("public", encoding="utf-8")
    (tmp_path / "debug.log").write_text("debug", encoding="utf-8")
    _git(tmp_path, "add", "README.md")

    staged = audit(tmp_path, Namespace(staged_only=True, tracked=False, git_ref=None, expected_files=None, export_list=None, denylist=None, private_patterns="missing.txt"))

    assert staged == []


def test_public_audit_expected_files_reports_missing_and_unexpected(tmp_path):
    (tmp_path / "README.md").write_text("public", encoding="utf-8")
    expected = tmp_path / "public-export-files.txt"
    expected.write_text("README.md\nsrc/app.py\n", encoding="utf-8")

    findings = audit(tmp_path, Namespace(staged_only=False, tracked=False, git_ref=None, expected_files="public-export-files.txt", export_list=None, denylist=None, private_patterns="missing.txt"))

    reasons = {(finding.path, finding.reason) for finding in findings}
    assert ("src/app.py", "expected file is missing from audit input") in reasons
    assert ("public-export-files.txt", "file is not listed in expected export file") in reasons


def test_public_audit_denylist_alias_flags_private_pattern(tmp_path):
    (tmp_path / "README.md").write_text("PRIVATE_MARKER", encoding="utf-8")
    (tmp_path / "deny.txt").write_text("PRIVATE_MARKER\n", encoding="utf-8")

    findings = audit(tmp_path, Namespace(staged_only=False, tracked=False, git_ref=None, expected_files=None, export_list=None, denylist="deny.txt", private_patterns="missing.txt"))

    assert any(finding.reason == "private denylist pattern" for finding in findings)


def test_public_audit_flags_forbidden_media_and_windows_paths(tmp_path):
    (tmp_path / "image.png").write_bytes(b"\x89PNG\r\n")
    local_path = "D:" + r"\Repos\ExampleProject"
    (tmp_path / "notes.md").write_text(f"Path: {local_path}", encoding="utf-8")

    findings = audit(tmp_path, Namespace(staged_only=False, tracked=False, git_ref=None, expected_files=None, export_list=None, denylist=None, private_patterns="missing.txt"))
    reasons = " ".join(finding.reason for finding in findings)

    assert "screenshots, media, dumps, or binary artifacts require explicit review" in reasons
    assert "local user or repository path" in reasons


def test_public_audit_accepts_generalized_example_paths(tmp_path):
    (tmp_path / "notes.md").write_text(
        "Examples: <PROJECT_ROOT> %USERPROFILE% %LOCALAPPDATA% C:\\Tools\\proxmark3 D:\\Projects\\rfid-workflow",
        encoding="utf-8",
    )

    findings = audit(tmp_path, Namespace(staged_only=False, tracked=False, git_ref=None, expected_files=None, export_list=None, denylist=None, private_patterns="missing.txt"))

    assert findings == []


def test_public_audit_empty_and_broken_denylist_return_usage_error(tmp_path):
    (tmp_path / "README.md").write_text("public", encoding="utf-8")
    (tmp_path / "deny.txt").write_text("# only comments\n", encoding="utf-8")
    assert main([str(tmp_path), "--denylist", "deny.txt"]) == 2

    (tmp_path / "deny.bin").write_bytes(b"\xff\xfe\xfa")
    assert main([str(tmp_path), "--denylist", "deny.bin"]) == 2


def _git(cwd, *args):
    if args[0] == "commit":
        full_args = ["git", *args, "--author", "Test User <test@example.invalid>"]
        env = {
            **__import__("os").environ,
            "GIT_COMMITTER_NAME": "Test User",
            "GIT_COMMITTER_EMAIL": "test@example.invalid",
        }
    else:
        full_args = ["git", *args]
        env = None
    completed = subprocess.run(full_args, cwd=cwd, capture_output=True, text=True, env=env, check=False)
    assert completed.returncode == 0, completed.stderr
    return completed
