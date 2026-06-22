from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path
import tempfile
from typing import Any


SETTINGS_FILENAME = "settings.json"
SUPPORTED_LANGUAGES = {"de", "en"}


@dataclass(frozen=True)
class AppSettings:
    language: str | None = None
    first_run_completed: bool = False
    show_startup_check_on_launch: bool = True
    last_known_pm3_path: str | None = None


def local_data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA")
    if base:
        return Path(base) / "PM3Workflow"
    return Path.home() / ".pm3-workflow"


def default_settings_path() -> Path:
    return local_data_dir() / SETTINGS_FILENAME


def load_settings(path: str | Path | None = None) -> AppSettings:
    settings_path = Path(path) if path else default_settings_path()
    try:
        payload = json.loads(settings_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return AppSettings()
    if not isinstance(payload, dict):
        return AppSettings()
    return AppSettings(
        language=_clean_language(payload.get("language")),
        first_run_completed=bool(payload.get("first_run_completed", False)),
        show_startup_check_on_launch=bool(payload.get("show_startup_check_on_launch", True)),
        last_known_pm3_path=_clean_optional_string(payload.get("last_known_pm3_path")),
    )


def save_settings(settings: AppSettings, path: str | Path | None = None) -> Path:
    settings_path = Path(path) if path else default_settings_path()
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    payload = asdict(settings)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{settings_path.name}.",
        suffix=".tmp",
        dir=str(settings_path.parent),
        text=True,
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temp_path, settings_path)
    except Exception:
        try:
            temp_path.unlink(missing_ok=True)
        finally:
            raise
    return settings_path


def update_settings(updates: dict[str, Any], path: str | Path | None = None) -> AppSettings:
    current = load_settings(path)
    next_settings = AppSettings(
        language=_clean_language(updates.get("language", current.language)),
        first_run_completed=bool(updates.get("first_run_completed", current.first_run_completed)),
        show_startup_check_on_launch=bool(
            updates.get("show_startup_check_on_launch", current.show_startup_check_on_launch)
        ),
        last_known_pm3_path=_clean_optional_string(updates.get("last_known_pm3_path", current.last_known_pm3_path)),
    )
    save_settings(next_settings, path)
    return next_settings


def settings_payload(settings: AppSettings) -> dict[str, Any]:
    return asdict(settings) | {"settings_path": str(default_settings_path())}


def _clean_language(value: Any) -> str | None:
    language = str(value).strip().lower() if value is not None else ""
    return language if language in SUPPORTED_LANGUAGES else None


def _clean_optional_string(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None
