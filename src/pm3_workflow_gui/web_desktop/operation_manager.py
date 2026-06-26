from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock, Thread
from typing import Any, Callable
from uuid import uuid4


TERMINAL_STATES = {"succeeded", "failed", "verification_failed", "connection_lost"}


class ConnectionLostError(RuntimeError):
    """Raised when an operation cannot continue because the PM3 disappeared."""


class VerificationFailedError(RuntimeError):
    """Raised when a write completed but the required re-read did not match."""


ProgressCallback = Callable[[str | dict[str, Any]], None]
OperationCallback = Callable[[ProgressCallback], dict]


@dataclass
class Operation:
    operation_id: str
    kind: str
    state: str = "queued"
    message: str = "Wartet ..."
    message_key: str = "operation.waiting"
    progress: list[str] = field(default_factory=list)
    progress_keys: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)
    result: dict | None = None
    error: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def snapshot(self) -> dict:
        return {
            "operation_id": self.operation_id,
            "kind": self.kind,
            "state": self.state,
            "message": self.message,
            "message_key": self.message_key,
            "progress": list(self.progress),
            "progress_keys": list(self.progress_keys),
            "details": dict(self.details),
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class OperationManager:
    def __init__(self) -> None:
        self._lock = Lock()
        self._operations: dict[str, Operation] = {}

    def start(self, kind: str, callback: OperationCallback) -> str:
        operation_id = f"op_{uuid4().hex}"
        operation = Operation(operation_id=operation_id, kind=kind)
        with self._lock:
            self._operations[operation_id] = operation
        thread = Thread(target=self._run, args=(operation_id, callback), daemon=True)
        thread.start()
        return operation_id

    def get(self, operation_id: str) -> dict:
        with self._lock:
            operation = self._operations.get(operation_id)
            if operation is None:
                return {
                    "operation_id": operation_id,
                    "kind": "unknown",
                    "state": "failed",
                    "message": "Unbekannte Operation",
                    "message_key": "operation.unknown",
                    "progress": [],
                    "progress_keys": [],
                    "result": None,
                    "error": "unknown operation",
                }
            return operation.snapshot()

    def _run(self, operation_id: str, callback: OperationCallback) -> None:
        self._set_running(operation_id)

        def progress(message: str | dict[str, Any]) -> None:
            self._set_progress(operation_id, message)

        try:
            result = callback(progress)
        except ConnectionLostError as exc:
            self._finish(operation_id, "connection_lost", "Verbindung verloren · Bitte PM3 neu verbinden.", None, str(exc), "connection.reconnect")
        except VerificationFailedError as exc:
            self._finish(operation_id, "verification_failed", str(exc), None, str(exc))
        except Exception as exc:  # pragma: no cover - kept as operation boundary.
            self._finish(operation_id, "failed", "Operation fehlgeschlagen.", None, str(exc), "operation.failed")
        else:
            message = result.get("message", "Operation abgeschlossen") if isinstance(result, dict) else "Operation abgeschlossen"
            message_key = result.get("message_key") if isinstance(result, dict) else None
            self._finish(operation_id, "succeeded", message, result, None, message_key)

    def _set_running(self, operation_id: str) -> None:
        with self._lock:
            operation = self._operations[operation_id]
            operation.state = "running"
            operation.message = "Operation läuft ..."
            operation.message_key = "operation.running"
            operation.updated_at = _now()

    def _set_progress(self, operation_id: str, payload: str | dict[str, Any]) -> None:
        with self._lock:
            operation = self._operations[operation_id]
            if isinstance(payload, dict):
                message = str(payload.get("message") or operation.message)
                message_key = str(payload.get("message_key") or _message_key(message) or operation.message_key)
                details = {key: value for key, value in payload.items() if key not in {"message", "message_key"}}
                operation.details.update(details)
            else:
                message = payload
                message_key = _message_key(message) or operation.message_key
            operation.message = message
            operation.message_key = message_key
            operation.progress.append(message)
            operation.progress_keys.append(message_key)
            operation.updated_at = _now()

    def _finish(
        self,
        operation_id: str,
        state: str,
        message: str,
        result: dict | None,
        error: str | None,
        message_key: str | None = None,
    ) -> None:
        with self._lock:
            operation = self._operations[operation_id]
            operation.state = state
            operation.message = message
            operation.message_key = message_key or _message_key(message) or operation.message_key
            operation.result = result
            operation.error = error
            operation.updated_at = _now()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _message_key(message: str) -> str | None:
    return {
        "Wartet ...": "operation.waiting",
        "Operation läuft ...": "operation.running",
        "Operation abgeschlossen": "operation.completed",
        "Operation fehlgeschlagen.": "operation.failed",
        "PM3 wird geprueft ...": "operation.pm3Checking",
        "Scan wird gestartet ...": "operation.scanStarting",
        "Aktueller Chip wird gelesen ...": "operation.currentChipReading",
        "Backup wird gespeichert ...": "operation.backupSaving",
        "Antennenpruefung laeuft ...": "operation.antennaRunning",
        "Antennenprüfung läuft ...": "operation.antennaRunning",
        "Position wird mit echten Read-only-Messungen geprueft ...": "operation.positionRunning",
        "Verbindung verloren · Bitte PM3 neu verbinden.": "connection.reconnect",
        "Der Transponder entspricht der Vorlage.": "write.matchesTemplate",
        "Vorlage erfolgreich übernommen und geprüft.": "write.templateAppliedVerified",
        "Änderung erfolgreich geprüft.": "write.singleChangeVerified",
        "Die Vorlage kann mit diesem Transponder nicht vollständig übernommen werden.": "write.templateCannotBeFullyApplied",
    }.get(message)
