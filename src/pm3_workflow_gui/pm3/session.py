from dataclasses import dataclass
from pathlib import Path
import subprocess


@dataclass(frozen=True)
class CommandResult:
    command: str
    returncode: int
    stdout: str
    stderr: str


class ProxmarkSession:
    """Small non-interactive wrapper around an external proxmark3.exe.

    The real GUI should move to a persistent process adapter if the client
    proves unreliable in single-command mode on Windows.
    """

    def __init__(self, executable: str | Path, port: str | None = None, timeout_seconds: int = 30) -> None:
        self.executable = Path(executable)
        self.port = port
        self.timeout_seconds = timeout_seconds

    def validate(self) -> None:
        if not self.executable.exists():
            raise FileNotFoundError(f"Proxmark3 executable not found: {self.executable}")
        if self.executable.name.lower() != "proxmark3.exe":
            raise ValueError(f"Expected proxmark3.exe, got: {self.executable.name}")

    def run_read_only(self, command: str) -> CommandResult:
        if command.strip().lower() not in {"hw version", "hw tune", "hf search", "lf search"} and not command.strip().endswith(" -h"):
            raise ValueError(f"Refusing non-discovery command in read-only runner: {command}")
        return self._run(command)

    def _run(self, command: str) -> CommandResult:
        self.validate()
        args = [str(self.executable)]
        if self.port:
            args.append(self.port)
        args.extend(["-c", command])
        completed = subprocess.run(
            args,
            check=False,
            capture_output=True,
            text=True,
            timeout=self.timeout_seconds,
        )
        return CommandResult(command, completed.returncode, completed.stdout, completed.stderr)

