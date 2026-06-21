from dataclasses import dataclass

from pm3_workflow_gui.pm3.risk import RiskLevel


@dataclass(frozen=True)
class CommandDefinition:
    name: str
    command: str
    risk: RiskLevel
    description: str


COMMANDS = {
    "pm3_list": CommandDefinition("PM3 port list", "bash pm3 --list", RiskLevel.READ_ONLY, "List possible Proxmark serial ports."),
    "hw_version": CommandDefinition("Hardware version", "hw version", RiskLevel.READ_ONLY, "Read firmware and hardware information."),
    "hw_tune": CommandDefinition("Hardware tune", "hw tune", RiskLevel.READ_ONLY, "Read antenna tuning values."),
    "hf_search": CommandDefinition("HF search", "hf search", RiskLevel.READ_ONLY, "Search for HF transponders."),
    "lf_search": CommandDefinition("LF search", "lf search", RiskLevel.READ_ONLY, "Search for LF transponders."),
    "indala_reader": CommandDefinition("Indala reader", "lf indala reader", RiskLevel.READ_ONLY, "Read public Indala identity data from the antenna."),
    "hitag_s256": CommandDefinition("Hitag S help", "lf hitag hts", RiskLevel.READ_ONLY, "Show Hitag S command family help."),
    "hitag_s256_list": CommandDefinition("Hitag S trace list", "lf hitag hts list", RiskLevel.READ_ONLY, "List Hitag S trace history."),
    "hitag_s256_read_block": CommandDefinition("Hitag S read block", "lf hitag hts rdbl", RiskLevel.READ_ONLY, "Read a Hitag S block/page."),
    "hitag_s256_write_block": CommandDefinition("Hitag S write block", "lf hitag hts wrbl", RiskLevel.WRITE, "Write a Hitag S block/page; gated by workflow rules."),
    "hitag_s256_dump": CommandDefinition("Hitag S dump", "lf hitag hts dump", RiskLevel.READ_ONLY_WITH_FILE_OUTPUT, "Dump readable Hitag S pages to a file."),
    "hitag_s256_restore": CommandDefinition("Hitag S restore", "lf hitag hts restore", RiskLevel.HIGH_RISK_WRITE, "Restore Hitag S memory from a dump file."),
    "hitag_s256_sim": CommandDefinition("Hitag S simulation", "lf hitag hts sim", RiskLevel.EMULATION, "Simulate a Hitag S transponder."),
}


def get_command(key: str) -> CommandDefinition:
    return COMMANDS[key]


def get_command_by_text(command: str) -> CommandDefinition | None:
    normalized = command.strip().lower()
    matches = sorted(
        (definition for definition in COMMANDS.values() if normalized.startswith(definition.command)),
        key=lambda definition: len(definition.command),
        reverse=True,
    )
    return matches[0] if matches else None
