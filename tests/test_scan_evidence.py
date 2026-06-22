from pathlib import Path

from pm3_workflow_gui.services.scan_evidence import evaluate_scan_evidence, scan_attempt_from_lf


FIXTURES = Path(__file__).parent / "fixtures" / "pm3"


def test_indala_false_positive_with_changing_bit_length_is_ambiguous():
    attempts = (
        scan_attempt_from_lf(
            "lf search",
            "[=] Odd size,  false positive?\n"
            "[+] Indala (len 151)  Raw: 800000000000000000000000000000000003FFFFC000000000000000\n",
        ),
        scan_attempt_from_lf(
            "lf search",
            "[=] Odd size,  false positive?\n"
            "[+] Indala (len 200)  Raw: 800000000000000000000000000000000000000000000001FFFFE000\n",
        ),
    )

    evidence = evaluate_scan_evidence(attempts)

    assert evidence.state == "signal_detected_but_ambiguous"
    assert "false_positive" in evidence.warnings
    assert "odd_size" in evidence.warnings
    assert "unstable_raw" in evidence.warnings
    assert "unstable_bit_length" in evidence.warnings
    assert evidence.candidate.family == "indala"
    assert evidence.candidate.confirmed is False


def test_stable_hitag_candidate_is_confirmed_after_repeat():
    output = (FIXTURES / "lf_search_hitag_s256_blank.txt").read_text(encoding="utf-8")

    evidence = evaluate_scan_evidence(
        (
            scan_attempt_from_lf("lf search", output),
            scan_attempt_from_lf("lf search", output),
        )
    )

    assert evidence.state == "technology_confirmed"
    assert evidence.candidate.family == "hitag_candidate"
    assert evidence.candidate.uid_or_raw_value == "11223344"
