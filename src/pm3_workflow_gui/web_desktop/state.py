from __future__ import annotations

from dataclasses import dataclass
from threading import RLock

from pm3_workflow_gui.profiles.backups import BackupRecord
from pm3_workflow_gui.profiles.storage import TemplateRecord
from pm3_workflow_gui.ui.viewmodel import ChipReadViewModel


@dataclass(frozen=True)
class ConnectionSnapshot:
    status: str
    connected: bool
    message: str
    port: str | None = None
    target: str | None = None
    client_version: str | None = None


@dataclass(frozen=True)
class TargetSnapshot:
    kind: str
    item_id: str
    label: str
    template: TemplateRecord | None = None
    backup: BackupRecord | None = None


class WebDesktopState:
    def __init__(self) -> None:
        self._lock = RLock()
        self.connection = ConnectionSnapshot("checking", False, "Verbindung wird geprüft ...")
        self.last_scan: ChipReadViewModel | None = None
        self.last_scan_confirmed = False
        self.last_scan_second_status = "nicht ausgeführt"
        self.current_chip: ChipReadViewModel | None = None
        self.current_backup: BackupRecord | None = None
        self.target: TargetSnapshot | None = None

    def set_connection(self, snapshot: ConnectionSnapshot) -> None:
        with self._lock:
            self.connection = snapshot
            if not snapshot.connected:
                self.current_chip = None
                self.current_backup = None

    def mark_connection_lost(self, message: str = "Verbindung verloren · Bitte PM3 neu verbinden.") -> None:
        with self._lock:
            self.connection = ConnectionSnapshot("lost", False, message)
            self.last_scan = None
            self.last_scan_confirmed = False
            self.last_scan_second_status = "nicht ausgeführt"
            self.current_chip = None
            self.current_backup = None

    def set_last_scan(self, scan: ChipReadViewModel | None, confirmed: bool, second_status: str) -> None:
        with self._lock:
            self.last_scan = scan
            self.last_scan_confirmed = confirmed
            self.last_scan_second_status = second_status

    def clear_last_scan(self) -> None:
        self.set_last_scan(None, confirmed=False, second_status="nicht ausgeführt")

    def set_current_chip(self, chip: ChipReadViewModel | None, backup: BackupRecord | None = None) -> None:
        with self._lock:
            self.current_chip = chip
            self.current_backup = backup

    def clear_current_chip(self) -> None:
        self.set_current_chip(None, None)

    def set_target(self, target: TargetSnapshot | None) -> None:
        with self._lock:
            self.target = target

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "connection": self.connection,
                "last_scan": self.last_scan,
                "last_scan_confirmed": self.last_scan_confirmed,
                "last_scan_second_status": self.last_scan_second_status,
                "current_chip": self.current_chip,
                "current_backup": self.current_backup,
                "target": self.target,
            }
