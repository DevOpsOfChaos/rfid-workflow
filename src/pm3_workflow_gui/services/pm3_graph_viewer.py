from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import subprocess
from typing import Mapping


ALLOWED_GRAPH_COMMANDS = frozenset(
    {
        "hw tune",
        "lf read;data plot",
    }
)


@dataclass(frozen=True)
class Pm3GraphWorkflow:
    key: str
    measurement_command: str
    plot_command: str | None
    start_method: str
    opens_separate_window: bool
    locally_confirmed: bool
    failure_reason: str = ""

    @property
    def command_sequence(self) -> str:
        if self.plot_command:
            return f"{self.measurement_command};{self.plot_command}"
        return self.measurement_command

    @property
    def enabled(self) -> bool:
        return self.locally_confirmed and self.opens_separate_window


LOCAL_GRAPH_WORKFLOW = Pm3GraphWorkflow(
    key="lf_read_data_plot",
    measurement_command="lf read",
    plot_command="data plot",
    start_method='proxmark3.exe <port> -c "lf read;data plot"',
    opens_separate_window=False,
    locally_confirmed=False,
    failure_reason=(
        "Lokaler Test am 2026-06-21: Help-Ausgaben vorhanden, COM16 erkannt, "
        "`hw tune` und `lf read;data plot` liefen read-only, aber es blieb kein separates PM3-/Qt-Fenster offen."
    ),
)


@dataclass(frozen=True)
class Pm3GraphLaunch:
    command: tuple[str, ...]
    pid: int
    port: str
    workflow: Pm3GraphWorkflow


class Pm3GraphViewer:
    def __init__(
        self,
        client_dir: str | Path,
        proxmark_exe: str | Path,
        workflow: Pm3GraphWorkflow = LOCAL_GRAPH_WORKFLOW,
        env: Mapping[str, str] | None = None,
    ) -> None:
        self.client_dir = Path(client_dir)
        self.proxmark_exe = Path(proxmark_exe)
        self.workflow = workflow
        self.env = dict(env) if env is not None else None

    def launch(self, port: str) -> Pm3GraphLaunch:
        if not self.workflow.enabled:
            reason = self.workflow.failure_reason or "Kein lokal bestätigter PM3-/Qt-Diagrammablauf."
            raise RuntimeError(f"Frequenzdiagramm technisch nicht verfügbar: {reason}")
        command_sequence = self.workflow.command_sequence
        if command_sequence not in ALLOWED_GRAPH_COMMANDS:
            raise ValueError(f"Kein registrierter PM3-Diagrammablauf für: {command_sequence}")
        command = [str(self.proxmark_exe), port, "-c", command_sequence]
        process = subprocess.Popen(
            command,
            cwd=self.client_dir,
            env=self.env,
            creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0),
            close_fds=True,
        )
        return Pm3GraphLaunch(tuple(command), process.pid, port, self.workflow)
