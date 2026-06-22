from __future__ import annotations

import json

from pm3_workflow_gui.profiles.settings import AppSettings, load_settings, save_settings, update_settings


def test_settings_store_survives_missing_and_corrupt_file(tmp_path):
    path = tmp_path / "settings.json"

    assert load_settings(path) == AppSettings()

    path.write_text("{broken", encoding="utf-8")
    assert load_settings(path) == AppSettings()


def test_settings_store_writes_atomically_and_filters_language(tmp_path):
    path = tmp_path / "settings.json"

    save_settings(AppSettings(language="de", first_run_completed=True), path)
    payload = json.loads(path.read_text(encoding="utf-8"))

    assert payload["language"] == "de"
    assert payload["first_run_completed"] is True

    updated = update_settings({"language": "fr", "show_startup_check_on_launch": False}, path)
    assert updated.language is None
    assert updated.show_startup_check_on_launch is False
