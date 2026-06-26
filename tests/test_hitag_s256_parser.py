from pm3_workflow_gui.pm3.parsers import parse_hitag_s256_pages, parse_uid


SAMPLE_OUTPUT = """
UID: A1 B2 C3 D4
Page 0: A1 B2 C3 D4 RO UID
Page 1: C9 28 00 AA Config
Page 2: 44 45 4D 4F
Page 3: 54 45 53 54
Page 4: A4 10 B4 20
Page 5: C5 30 D5 40
Page 6: E6 50 F6 60
Page 7: 00 00 00 00
"""


def test_parse_uid():
    assert parse_uid(SAMPLE_OUTPUT) == "A1 B2 C3 D4"


def test_parse_pages():
    pages = parse_hitag_s256_pages(SAMPLE_OUTPUT)
    assert pages[0] == "A1 B2 C3 D4"
    assert pages[1] == "C9 28 00 AA"
    assert pages[7] == "00 00 00 00"
