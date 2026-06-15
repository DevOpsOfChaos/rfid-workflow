from __future__ import annotations

import sys


PYSIDE_MISSING_MESSAGE = "PySide6 is not installed. Create and activate .venv-gui, then install PySide6."


def main(argv: list[str] | None = None) -> int:
    try:
        from PySide6.QtWidgets import QApplication
        from pm3_workflow_gui.ui.main_window import MainWindow
    except RuntimeError as exc:
        print(exc)
        return 1
    except ImportError:
        print(PYSIDE_MISSING_MESSAGE)
        return 1

    app = QApplication(argv or sys.argv)
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
