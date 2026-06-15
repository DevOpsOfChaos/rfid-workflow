from pathlib import Path

import pytest

from pm3_workflow_gui.pm3.session import Pm3LaunchConfig


PROXMARK_ROOT = Path(r"C:\Tools\proxmark3")
CLIENT_DIR = PROXMARK_ROOT / "client"


def test_client_setup_bash_builds_windows_start_command_with_com_port():
    config = Pm3LaunchConfig(
        mode="client_setup_bash",
        proxmark_root=PROXMARK_ROOT,
        client_dir=CLIENT_DIR,
        launcher_bat=PROXMARK_ROOT / "pm3.bat",
        com_port="COM16",
    )

    assert config.planned_command() == [
        "cmd.exe",
        "/k",
        r"cd /d C:\Tools\proxmark3\client && call setup.bat && bash pm3 -p COM16",
    ]


def test_proxspace_bat_requires_batch_launcher():
    config = Pm3LaunchConfig(
        mode="proxspace_bat",
        proxmark_root=PROXMARK_ROOT,
        client_dir=CLIENT_DIR,
        launcher_bat=PROXMARK_ROOT / "start-proxmark.bat",
        com_port="COM11",
    )

    assert config.require_batch_launcher() == PROXMARK_ROOT / "start-proxmark.bat"
    assert config.planned_command() == [r"C:\Tools\proxmark3\start-proxmark.bat"]


def test_proxspace_bat_rejects_non_batch_launcher():
    config = Pm3LaunchConfig(
        mode="proxspace_bat",
        proxmark_root=PROXMARK_ROOT,
        client_dir=CLIENT_DIR,
        launcher_bat=PROXMARK_ROOT / "proxmark3.exe",
    )

    with pytest.raises(ValueError, match="Expected a batch launcher"):
        config.planned_command()


def test_direct_exe_remains_supported_but_is_only_one_launch_mode():
    config = Pm3LaunchConfig(
        mode="direct_exe",
        proxmark_root=PROXMARK_ROOT,
        client_dir=CLIENT_DIR,
        com_port="COM16",
    )

    assert config.planned_command() == [r"C:\Tools\proxmark3\client\proxmark3.exe", "COM16"]


def test_discovery_docs_keep_client_setup_bash_as_system_path():
    docs = Path("docs/PM3_COMMANDS_DISCOVERY.md").read_text(encoding="utf-8")

    assert "client_setup_bash" in docs
    assert 'cmd /k "cd /d C:\\Tools\\proxmark3\\client && call setup.bat && bash pm3 -p COM16"' in docs
    assert "direct `proxmark3.exe` calls" in docs.lower()
