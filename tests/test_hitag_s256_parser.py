from pm3_workflow_gui.pm3.parsers import parse_hitag_s256_pages, parse_uid


SAMPLE_OUTPUT = """
UID: FA F9 91 79
Page 0: FA F9 91 79 RO UID
Page 1: C9 28 00 AA Config
Page 2: 48 54 4F 4E
Page 3: 4D 49 4B 52
Page 4: FF F8 06 97
Page 5: 8C 66 C1 80
Page 6: 03 6E F7 00
Page 7: 00 00 00 00
"""


def test_parse_uid():
    assert parse_uid(SAMPLE_OUTPUT) == "FA F9 91 79"


def test_parse_pages():
    pages = parse_hitag_s256_pages(SAMPLE_OUTPUT)
    assert pages[0] == "FA F9 91 79"
    assert pages[1] == "C9 28 00 AA"
    assert pages[7] == "00 00 00 00"

