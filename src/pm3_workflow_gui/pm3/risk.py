from enum import Enum


class RiskLevel(str, Enum):
    READ_ONLY = "read_only"
    WRITE = "write"
    HIGH_RISK_CONFIG = "high_risk_config"
    LOCK_OR_CRYPTO = "lock_or_crypto"
    ATTACK_OR_BRUTEFORCE = "attack_or_bruteforce"


HIGH_RISK_TERMS = ("lock", "crypto", "auth", "password", "pwd")
ATTACK_TERMS = ("brute", "attack", "sniff", "simulate", "sim", "clone", "restore")


def classify_command(command: str) -> RiskLevel:
    normalized = command.lower()
    if any(term in normalized for term in ATTACK_TERMS):
        return RiskLevel.ATTACK_OR_BRUTEFORCE
    if any(term in normalized for term in HIGH_RISK_TERMS):
        return RiskLevel.LOCK_OR_CRYPTO
    if " wrbl" in normalized or normalized.endswith("wrbl") or " write" in normalized:
        if " page 1" in normalized or " config" in normalized:
            return RiskLevel.HIGH_RISK_CONFIG
        return RiskLevel.WRITE
    return RiskLevel.READ_ONLY

