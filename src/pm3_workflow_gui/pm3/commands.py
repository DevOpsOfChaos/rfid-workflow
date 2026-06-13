from dataclasses import dataclass

from pm3_workflow_gui.pm3.risk import RiskLevel


@dataclass(frozen=True)
class CommandDefinition:
    name: str
    command: str
    risk: RiskLevel
    description: str


COMMANDS = {
    "hw_version": CommandDefinition("Hardware version", "hw version", RiskLevel.READ_ONLY, "Read firmware and hardware information."),
    "hw_tune": CommandDefinition("Hardware tune", "hw tune", RiskLevel.READ_ONLY, "Read antenna tuning values."),
    "hf_search": CommandDefinition("HF search", "hf search", RiskLevel.READ_ONLY, "Search for HF transponders."),
    "lf_search": CommandDefinition("LF search", "lf search", RiskLevel.READ_ONLY, "Search for LF transponders."),
    "hitag_s256_read_block": CommandDefinition("Hitag S read block", "lf hitag hts rdbl", RiskLevel.READ_ONLY, "Read a Hitag S block/page."),
    "hitag_s256_write_block": CommandDefinition("Hitag S write block", "lf hitag hts wrbl", RiskLevel.WRITE, "Write a Hitag S block/page; gated by workflow rules."),
    "hitag_s256_dump": CommandDefinition("Hitag S dump", "lf hitag hts dump", RiskLevel.READ_ONLY, "Dump readable Hitag S pages."),
}


def get_command(key: str) -> CommandDefinition:
    return COMMANDS[key]

