from __future__ import annotations

from argparse import Namespace

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


def test_public_audit_flags_private_denylist_without_modifying_files(tmp_path):
    denylist = tmp_path / ".public-audit-private-patterns.txt"
    denylist.write_text("PRIVATE_TEST_PATTERN_123\n", encoding="utf-8")
    public_file = tmp_path / "README.md"
    public_file.write_text("contains PRIVATE_TEST_PATTERN_123", encoding="utf-8")
    before = public_file.read_text(encoding="utf-8")

    exit_code = main([str(tmp_path), "--private-patterns", ".public-audit-private-patterns.txt"])

    assert exit_code == 1
    assert public_file.read_text(encoding="utf-8") == before
