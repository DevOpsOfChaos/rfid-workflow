from enum import Enum


class RiskLevel(str, Enum):
    READ_ONLY = "read_only"
    READ_ONLY_WITH_FILE_OUTPUT = "read_only_with_file_output"
    WRITE = "write"
    HIGH_RISK_WRITE = "high_risk_write"
    HIGH_RISK_CONFIG = "high_risk_config"
    ADVANCED_AUTH = "advanced_auth"
    EMULATION = "emulation"
    LOCK_OR_CRYPTO = "lock_or_crypto"
    ATTACK_OR_BRUTEFORCE = "attack_or_bruteforce"


HIGH_RISK_TERMS = ("lock", "crypto", "auth", "password", "pwd")
ADVANCED_AUTH_FLAGS = ("--crypto", "--82xx", "--nrar", " -k ", " --key ")
ATTACK_TERMS = ("brute", "attack", "sniff", "clone", "autopwn")


def classify_command(command: str) -> RiskLevel:
    normalized = f" {command.lower().strip()} "
    if " sim " in normalized or normalized.endswith(" sim "):
        return RiskLevel.EMULATION
    if " restore " in normalized or normalized.endswith(" restore "):
        return RiskLevel.HIGH_RISK_WRITE
    if any(term in normalized for term in ATTACK_TERMS):
        return RiskLevel.ATTACK_OR_BRUTEFORCE
    if any(flag in normalized for flag in ADVANCED_AUTH_FLAGS):
        return RiskLevel.ADVANCED_AUTH
    if any(term in normalized for term in HIGH_RISK_TERMS):
        return RiskLevel.LOCK_OR_CRYPTO
    if " wrbl " in normalized or " write " in normalized:
        if " page 1" in normalized or " config" in normalized:
            return RiskLevel.HIGH_RISK_CONFIG
        return RiskLevel.WRITE
    if " dump " in normalized:
        return RiskLevel.READ_ONLY_WITH_FILE_OUTPUT
    return RiskLevel.READ_ONLY
