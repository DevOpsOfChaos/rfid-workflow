from dataclasses import dataclass
from pathlib import Path
import subprocess
from typing import Literal


@dataclass(frozen=True)
class CommandResult:
    command: str
    returncode: int
    stdout: str
    stderr: str


Pm3LaunchMode = Literal["direct_exe", "proxspace_bat", "client_setup_bash"]


@dataclass(frozen=True)
class Pm3LaunchConfig:
    """Describes how a local Proxmark3 client should be started.

    This is intentionally a launch-plan model. Interactive MSYS/ProxSpace
    automation needs a dedicated adapter with real hardware testing.
    """

    mode: Pm3LaunchMode
    proxmark_root: Path
    client_dir: Path
    launcher_bat: Path | None = None
    com_port: str | None = None
    bash_command: str = "bash pm3"

    def planned_command(self) -> list[str]:
        if self.mode == "direct_exe":
            args = [str(self.client_dir / "proxmark3.exe")]
            if self.com_port:
                args.append(self.com_port)
            return args

        if self.mode == "proxspace_bat":
            launcher = self.require_batch_launcher()
            return [str(launcher)]

        if self.mode == "client_setup_bash":
            command = f"cd /d {self.client_dir} && call setup.bat && {self._bash_command_with_port()}"
            return ["cmd.exe", "/k", command]

        raise ValueError(f"Unsupported Proxmark launch mode: {self.mode}")

    def planned_command_display(self) -> str:
        return " ".join(f'"{arg}"' if " " in arg else arg for arg in self.planned_command())

    def require_batch_launcher(self) -> Path:
        if self.launcher_bat is None:
            raise ValueError("proxspace_bat mode requires launcher_bat")
        if self.launcher_bat.suffix.lower() not in {".bat", ".cmd"}:
            raise ValueError(f"Expected a batch launcher, got: {self.launcher_bat}")
        return self.launcher_bat

    def _bash_command_with_port(self) -> str:
        """Return auto-detect bash command, or append a forced COM override."""
        if self.com_port and "-p" not in self.bash_command.split():
            return f"{self.bash_command} -p {self.com_port}"
        return self.bash_command


class ProxmarkSession:
    """Small non-interactive wrapper around a direct proxmark3.exe launch.

    This remains available for installations where direct executable startup
    works. ProxSpace/MSYS setups should be represented with Pm3LaunchConfig
    first and need a separate interactive adapter before command execution.
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
