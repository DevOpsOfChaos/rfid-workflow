from __future__ import annotations

from pathlib import Path

from pm3_workflow_gui.profiles.storage import TemplateRecord, default_template_dir, load_template_records
from pm3_workflow_gui.services.live_pm3_readonly import LivePm3ReadonlyService
from pm3_workflow_gui.ui.viewmodel import (
    ChipReadViewModel,
    TemplateValidationViewModel,
    build_write_plan_view_model,
    chip_read_view_model_from_positioning_result,
    chip_read_view_model_from_live_result,
    hardware_prep_from_check,
    hardware_prep_initial,
    save_confirmed_template,
    startup_view_model_error,
    startup_view_model_from_check,
    startup_view_model_initial,
    unavailable_write_plan_view_model,
    validate_second_scan,
)


try:
    from PySide6.QtCore import QObject, QThread, Qt, Signal
    from PySide6.QtGui import QAction, QKeySequence
    from PySide6.QtWidgets import (
        QAbstractItemView,
        QButtonGroup,
        QCheckBox,
        QDialog,
        QDialogButtonBox,
        QFrame,
        QGridLayout,
        QHBoxLayout,
        QHeaderView,
        QLabel,
        QLineEdit,
        QListWidget,
        QMainWindow,
        QMessageBox,
        QPlainTextEdit,
        QProgressBar,
        QPushButton,
        QSizePolicy,
        QStackedWidget,
        QTableWidget,
        QTableWidgetItem,
        QTextEdit,
        QVBoxLayout,
        QWidget,
    )
except ImportError as exc:  # pragma: no cover - exercised only when launching without PySide6
    raise RuntimeError("PySide6 is not installed. Create and activate .venv-gui, then install PySide6.") from exc


class _Worker(QObject):
    finished = Signal(object, object)

    def __init__(self, callback) -> None:
        super().__init__()
        self._callback = callback

    def run(self) -> None:
        try:
            self.finished.emit(self._callback(), None)
        except Exception as exc:  # pragma: no cover - UI worker error path
            self.finished.emit(None, exc)


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("PM3 Workflow")
        self.resize(1120, 720)
        self.setMinimumSize(940, 640)
        self.live_service = LivePm3ReadonlyService()
        self._worker_thread: QThread | None = None
        self._worker: _Worker | None = None
        self._port: str | None = None
        self._hardware_checked = False
        self._first_scan: ChipReadViewModel | None = None
        self._validation: TemplateValidationViewModel | None = None
        self._target_scan: ChipReadViewModel | None = None
        self._templates: list[tuple[Path, TemplateRecord]] = []
        self._raw_log: list[str] = []
        self._current_write_plan = None

        self.stack = QStackedWidget()
        self.setCentralWidget(self.stack)
        self._build_start_screen()
        self._build_prep_screen()
        self._build_main_screen()
        self._apply_style()
        self._render_start(startup_view_model_initial())
        self._render_prep(hardware_prep_initial())
        self._start_startup_check()

    def _build_start_screen(self) -> None:
        screen = QWidget()
        outer = QVBoxLayout(screen)
        outer.setAlignment(Qt.AlignCenter)
        panel = QFrame()
        panel.setObjectName("centerPanel")
        panel.setMaximumWidth(520)
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(38, 34, 38, 34)
        layout.setSpacing(12)
        layout.setAlignment(Qt.AlignCenter)
        self.start_icon = QLabel("▣")
        self.start_icon.setObjectName("heroIcon")
        self.start_icon.setAlignment(Qt.AlignCenter)
        self.start_title = QLabel("PM3 Workflow")
        self.start_title.setObjectName("startTitle")
        self.start_title.setAlignment(Qt.AlignCenter)
        self.start_message = QLabel("Proxmark wird verbunden ...")
        self.start_message.setObjectName("startMessage")
        self.start_message.setAlignment(Qt.AlignCenter)
        self.start_message.setWordWrap(True)
        self.start_progress = QProgressBar()
        self.start_progress.setRange(0, 0)
        self.start_progress.setFixedWidth(360)
        self.start_detail = QLabel("pm3 --list")
        self.start_detail.setObjectName("muted")
        self.start_detail.setAlignment(Qt.AlignCenter)
        self.start_state = QLabel("")
        self.start_state.setObjectName("successText")
        self.start_state.setAlignment(Qt.AlignCenter)
        self.retry_button = QPushButton("Erneut prüfen")
        self.retry_button.clicked.connect(self._start_startup_check)
        self.continue_button = QPushButton("Weiter")
        self.continue_button.setObjectName("primaryButton")
        self.continue_button.clicked.connect(lambda: self.stack.setCurrentIndex(1))
        row = QHBoxLayout()
        row.setAlignment(Qt.AlignCenter)
        row.addWidget(self.retry_button)
        row.addWidget(self.continue_button)
        layout.addWidget(self.start_icon)
        layout.addWidget(self.start_title)
        layout.addWidget(self.start_message)
        layout.addSpacing(8)
        layout.addWidget(self.start_progress, alignment=Qt.AlignCenter)
        layout.addWidget(self.start_detail)
        layout.addWidget(self.start_state)
        layout.addSpacing(20)
        layout.addLayout(row)
        outer.addWidget(panel)
        self.stack.addWidget(screen)

    def _build_prep_screen(self) -> None:
        screen = QWidget()
        outer = QVBoxLayout(screen)
        outer.setAlignment(Qt.AlignCenter)
        panel = QFrame()
        panel.setObjectName("centerPanel")
        panel.setMaximumWidth(560)
        layout = QVBoxLayout(panel)
        layout.setContentsMargins(38, 34, 38, 34)
        layout.setSpacing(12)
        layout.setAlignment(Qt.AlignCenter)
        self.prep_icon = QLabel("⌁")
        self.prep_icon.setObjectName("heroIcon")
        self.prep_icon.setAlignment(Qt.AlignCenter)
        self.prep_title = QLabel("Vorbereitung")
        self.prep_title.setObjectName("startTitle")
        self.prep_title.setAlignment(Qt.AlignCenter)
        self.prep_message = QLabel()
        self.prep_message.setObjectName("startMessage")
        self.prep_message.setAlignment(Qt.AlignCenter)
        self.prep_message.setWordWrap(True)
        self.prep_button = QPushButton("Kein Chip liegt auf · Hardware prüfen")
        self.prep_button.setObjectName("primaryButton")
        self.prep_button.clicked.connect(self._start_hardware_check)
        self.prep_progress = QProgressBar()
        self.prep_progress.setRange(0, 0)
        self.prep_progress.setFixedWidth(360)
        self.prep_progress.hide()
        self.prep_detail = QLabel("")
        self.prep_detail.setObjectName("muted")
        self.prep_detail.setAlignment(Qt.AlignCenter)
        self.prep_diagram = QLabel("Optional: LF-Positionsdiagramm in einem separaten PM3-Fenster öffnen.")
        self.prep_diagram.setObjectName("muted")
        self.prep_diagram.setAlignment(Qt.AlignCenter)
        self.prep_diagram.setWordWrap(True)
        self.prep_diagram_button = QPushButton("LF-Diagramm öffnen")
        self.prep_diagram_button.clicked.connect(self._open_frequency_diagram)
        enter = QAction(self)
        enter.setShortcut(QKeySequence(Qt.Key_Return))
        enter.triggered.connect(self.prep_button.click)
        self.addAction(enter)
        layout.addWidget(self.prep_icon)
        layout.addWidget(self.prep_title)
        layout.addWidget(self.prep_message)
        layout.addSpacing(10)
        layout.addWidget(self.prep_button, alignment=Qt.AlignCenter)
        layout.addWidget(self.prep_progress, alignment=Qt.AlignCenter)
        layout.addWidget(self.prep_detail)
        layout.addWidget(self.prep_diagram)
        layout.addWidget(self.prep_diagram_button, alignment=Qt.AlignCenter)
        outer.addWidget(panel)
        self.stack.addWidget(screen)

    def _build_main_screen(self) -> None:
        screen = QWidget()
        root = QVBoxLayout(screen)
        root.setContentsMargins(0, 0, 0, 0)
        self.header_dot = QLabel("●")
        self.header_dot.setObjectName("statusDot")
        self.header_label = QLabel("PM3 verbunden · unbekannt · LF/HF geprüft")
        self.header_label.setObjectName("headerLabel")
        help_button = QPushButton("Hilfe")
        help_button.setObjectName("smallButton")
        help_button.clicked.connect(self._show_help)
        header = QHBoxLayout()
        header.setContentsMargins(18, 10, 18, 10)
        header.addWidget(self.header_dot)
        header.addWidget(self.header_label)
        header.addStretch(1)
        header.addWidget(help_button)
        body = QHBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        self.nav = QListWidget()
        self.nav.setObjectName("nav")
        self.nav.addItems(["▣  Vorlage", "✎  Schreiben", "◇  Analyse"])
        self.nav.setFixedWidth(170)
        self.nav.currentRowChanged.connect(self._change_page)
        self.pages = QStackedWidget()
        self.pages.addWidget(self._template_page())
        self.pages.addWidget(self._write_page())
        self.pages.addWidget(self._analysis_page())
        body.addWidget(self.nav)
        body.addWidget(self.pages, 1)
        self.bottom_status = QLabel("Bereit · Lege einen Chip auf den Proxmark")
        self.bottom_status.setObjectName("statusBar")
        root.addLayout(header)
        self.header_label.setMaximumHeight(32)
        root.addWidget(_line())
        root.addLayout(body, 1)
        root.addWidget(_line())
        root.addWidget(self.bottom_status)
        self.nav.setCurrentRow(0)
        self.stack.addWidget(screen)

    def _template_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(28, 22, 28, 18)
        title = QLabel("Vorlage erstellen")
        title.setObjectName("pageTitle")
        subtitle = QLabel("Chip lesen und als Vorlage speichern")
        subtitle.setObjectName("muted")
        controls = QHBoxLayout()
        self.auto_detect = QCheckBox("Automatisch erkennen")
        self.auto_detect.setChecked(True)
        self.lf_button = QPushButton("LF")
        self.hf_button = QPushButton("HF")
        self.lf_button.hide()
        self.hf_button.hide()
        self.auto_detect.toggled.connect(self._toggle_manual_frequency)
        controls.addWidget(self.auto_detect)
        controls.addWidget(self.lf_button)
        controls.addWidget(self.hf_button)
        controls.addStretch(1)
        self.scan_button = QPushButton("Chip scannen")
        self.scan_button.setObjectName("primaryButton")
        self.scan_button.clicked.connect(self._scan_template_first)
        self.position_button = QPushButton("Position prüfen")
        self.position_button.clicked.connect(self._position_template)
        self.second_scan_button = QPushButton("Zweiten Scan durchführen")
        self.second_scan_button.clicked.connect(self._scan_template_second)
        self.second_scan_button.hide()
        self.save_template_button = QPushButton("Als Vorlage speichern")
        self.save_template_button.clicked.connect(self._save_template_dialog)
        self.save_template_button.hide()
        self.template_graph_button = QPushButton("Frequenzdiagramm öffnen")
        self.template_graph_button.clicked.connect(self._open_frequency_diagram)
        self.template_graph_button.setEnabled(self.live_service.graph_viewer_available())
        self.template_graph_button.hide()
        self.template_details_button = QPushButton("Technische Details")
        self.template_details_button.clicked.connect(self._show_technical_details)
        self.template_details_button.hide()
        action_row = QHBoxLayout()
        action_row.addWidget(self.scan_button)
        action_row.addWidget(self.position_button)
        action_row.addWidget(self.second_scan_button)
        action_row.addWidget(self.save_template_button)
        action_row.addWidget(self.template_graph_button)
        action_row.addWidget(self.template_details_button)
        action_row.addStretch(1)
        self.template_message = QLabel("Vorlage erstellen\nChip lesen und als Vorlage speichern")
        self.template_message.setObjectName("messagePanel")
        self.template_message.setWordWrap(True)
        self.template_table = QTableWidget(0, 3)
        self.template_table.setHorizontalHeaderLabels(["Feld", "Wert", "Hinweis"])
        self.template_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.template_diff_table = QTableWidget(0, 3)
        self.template_diff_table.setHorizontalHeaderLabels(["Feld", "Scan 1", "Scan 2"])
        self.template_diff_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        _polish_table(self.template_table)
        _polish_table(self.template_diff_table)
        self.template_table.hide()
        self.template_diff_table.hide()
        scan_panel = QFrame()
        scan_panel.setObjectName("sectionPanel")
        scan_layout = QVBoxLayout(scan_panel)
        scan_layout.setContentsMargins(18, 16, 18, 16)
        scan_layout.addLayout(controls)
        scan_layout.addLayout(action_row)
        scan_layout.addWidget(self.template_message)
        layout.addWidget(title)
        layout.addWidget(subtitle)
        layout.addSpacing(12)
        layout.addWidget(scan_panel)
        layout.addWidget(self.template_table, 1)
        layout.addWidget(self.template_diff_table)
        return page

    def _write_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(28, 22, 28, 18)
        title = QLabel("Schreiben")
        title.setObjectName("pageTitle")
        subtitle = QLabel("Hitag S256 einzeln schreiben · Zielchip wird nach jeder Aktion verifiziert")
        subtitle.setObjectName("muted")
        self.template_list = QListWidget()
        self.template_list.setMaximumHeight(92)
        self.template_list.currentRowChanged.connect(self._render_write_plan)
        self.refresh_templates_button = QPushButton("Vorlagen neu laden")
        self.refresh_templates_button.clicked.connect(self._load_templates)
        self.scan_target_button = QPushButton("Zielchip scannen")
        self.scan_target_button.setObjectName("primaryButton")
        self.scan_target_button.clicked.connect(self._scan_write_target)
        top = QHBoxLayout()
        top.addWidget(self.refresh_templates_button)
        top.addWidget(self.scan_target_button)
        top.addStretch(1)
        self.write_authorized = QCheckBox("Ich bestätige, dass ich berechtigt bin, diesen Chip zu beschreiben.")
        self.write_authorized.toggled.connect(self._render_write_plan)
        self.write_message = QLabel("Wähle eine Vorlage und scanne einen Zielchip.")
        self.write_message.setObjectName("messagePanel")
        self.write_message.setWordWrap(True)
        self.compare_table = QTableWidget(0, 5)
        self.compare_table.setHorizontalHeaderLabels(["Feld", "Aktueller Chip", "Vorlage", "Status", "Hinweis"])
        self.compare_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.plan_list = QListWidget()
        self.disabled_actions = QVBoxLayout()
        disabled_box = QWidget()
        disabled_box.setLayout(self.disabled_actions)
        _polish_table(self.compare_table)
        top_panel = QFrame()
        top_panel.setObjectName("sectionPanel")
        top_panel_layout = QVBoxLayout(top_panel)
        top_panel_layout.setContentsMargins(18, 16, 18, 16)
        top_panel_layout.addWidget(QLabel("Vorlage auswählen"))
        top_panel_layout.addWidget(self.template_list)
        top_panel_layout.addLayout(top)
        top_panel_layout.addWidget(self.write_authorized)
        top_panel_layout.addWidget(self.write_message)
        layout.addWidget(title)
        layout.addWidget(subtitle)
        layout.addSpacing(10)
        layout.addWidget(top_panel)
        layout.addWidget(self.compare_table, 1)
        layout.addWidget(QLabel("Schreibplan"))
        layout.addWidget(self.plan_list)
        layout.addWidget(disabled_box)
        self._load_templates()
        return page

    def _analysis_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setContentsMargins(28, 22, 28, 18)
        title = QLabel("Analyse")
        title.setObjectName("pageTitle")
        self.analysis_summary = QLabel("Letzte Messung\nNoch kein Scan ausgefuehrt.")
        self.analysis_summary.setObjectName("messagePanel")
        self.analysis_summary.setWordWrap(True)
        grid = QGridLayout()
        self.analysis_raw = QPlainTextEdit()
        self.analysis_raw.setReadOnly(True)
        cards = [
            ("Chip erkennen", "", True, self._analysis_chip_scan),
            ("Position prüfen", "", True, self._analysis_position_scan),
            ("Antenne prüfen", "", True, self._start_hardware_check),
            ("Frequenzdiagramm öffnen", "", self.live_service.graph_viewer_available(), self._open_frequency_diagram),
            ("Technische Details", "", True, self._show_technical_details),
        ]
        for index, (heading, text, enabled, callback) in enumerate(cards):
            card = self._analysis_card(heading, text, enabled, callback)
            grid.addWidget(card, index // 2, index % 2)
        self.analysis_raw.hide()
        layout.addWidget(title)
        layout.addWidget(self.analysis_summary)
        layout.addLayout(grid)
        layout.addWidget(self.analysis_raw, 1)
        return page

    def _analysis_card(self, heading: str, text: str, enabled: bool, callback) -> QWidget:
        box = QFrame()
        box.setObjectName("toolCard")
        layout = QVBoxLayout(box)
        title = QLabel(heading)
        title.setObjectName("cardTitle")
        desc = QLabel(text)
        desc.setWordWrap(True)
        desc.setObjectName("muted")
        button = QPushButton(heading)
        button.setEnabled(enabled)
        if callback:
            button.clicked.connect(callback)
        layout.addWidget(title)
        layout.addWidget(desc)
        layout.addStretch(1)
        layout.addWidget(button)
        return box

    def _start_startup_check(self) -> None:
        self._render_start(startup_view_model_initial())
        self.stack.setCurrentIndex(0)
        self._run_worker(self.live_service.startup_check, self._startup_finished)

    def _startup_finished(self, result, exc: Exception | None) -> None:
        if exc:
            self._render_start(startup_view_model_error(str(exc)))
            QMessageBox.warning(self, "Proxmark prüfen", str(exc))
            return
        model = startup_view_model_from_check(result)
        self._port = model.port
        self._render_start(model)

    def _start_hardware_check(self) -> None:
        self._set_status("Scan läuft · Hardware wird geprüft")
        self.prep_button.setEnabled(False)
        self.prep_progress.show()
        self._run_worker(lambda: self.live_service.hardware_check(self._port), self._hardware_finished)

    def _hardware_finished(self, result, exc: Exception | None) -> None:
        self.prep_button.setEnabled(True)
        self.prep_progress.hide()
        if exc:
            QMessageBox.warning(self, "Hardware prüfen", str(exc))
            self._set_status("Verbindung verloren")
            return
        model = hardware_prep_from_check(result)
        self._render_prep(model)
        if model.ready:
            self._hardware_checked = True
            self._set_status("Bereit · Lege einen Chip auf den Proxmark")
            self.header_label.setText(f"PM3 verbunden · {result.port or self._port or 'auto'} · LF/HF geprüft")
            self.stack.setCurrentIndex(2)
        else:
            self._set_status("Verbindung verloren")

    def _scan_template_first(self) -> None:
        self._set_status("Scan läuft · Suche LF/HF-Chip")
        self.template_message.setText("Chip wird erkannt ...\nSuche HF ...\nSuche LF ...\nPruefe Signal ...")
        self.scan_button.setEnabled(False)
        self.position_button.setEnabled(False)
        self.second_scan_button.hide()
        self.save_template_button.hide()
        self.template_graph_button.hide()
        self.template_details_button.hide()
        self.template_table.hide()
        self.template_diff_table.hide()
        self._run_worker(lambda: self.live_service.read_chip(self._port), self._template_first_finished)

    def _template_first_finished(self, result, exc: Exception | None) -> None:
        self.scan_button.setEnabled(True)
        self.position_button.setEnabled(True)
        if exc:
            self._scan_error(exc)
            return
        model = chip_read_view_model_from_live_result(result)
        self._first_scan = model if model.is_complete_template_read else None
        self._validation = None
        self._render_chip_read(model)
        self.second_scan_button.setVisible(model.is_complete_template_read)
        self.second_scan_button.setEnabled(model.is_complete_template_read)
        self.save_template_button.hide()
        self._append_raw(result)

    def _position_template(self) -> None:
        self._set_status("Scan läuft · Position wird geprüft")
        self.template_message.setText("Signal wird geprüft ...\nBewege den Chip langsam über die Antenne.")
        self.scan_button.setEnabled(False)
        self.position_button.setEnabled(False)
        self.second_scan_button.hide()
        self.save_template_button.hide()
        self.template_graph_button.hide()
        self.template_details_button.hide()
        self.template_table.hide()
        self.template_diff_table.hide()
        self._run_worker(lambda: self.live_service.position_chip(self._port), self._position_finished)

    def _position_finished(self, result, exc: Exception | None) -> None:
        self.scan_button.setEnabled(True)
        self.position_button.setEnabled(True)
        if exc:
            self._scan_error(exc)
            return
        model = chip_read_view_model_from_positioning_result(result)
        self._first_scan = None
        self._validation = None
        self._render_chip_read(model)
        self._append_raw(result)

    def _scan_template_second(self) -> None:
        if self._first_scan is None:
            return
        self._set_status("Scan läuft · Lese Chipdetails")
        self.template_message.setText("Lese Chipdetails ...")
        self.second_scan_button.setEnabled(False)
        self._run_worker(lambda: self.live_service.read_chip(self._port), self._template_second_finished)

    def _template_second_finished(self, result, exc: Exception | None) -> None:
        self.second_scan_button.setEnabled(True)
        if exc:
            self._scan_error(exc)
            return
        second = chip_read_view_model_from_live_result(result)
        self._append_raw(result)
        if self._first_scan is None:
            return
        validation = validate_second_scan(self._first_scan, second)
        self._validation = validation
        self._render_validation(validation)

    def _scan_write_target(self) -> None:
        self._set_status("Scan läuft · Zielchip wird gelesen")
        self.scan_target_button.setEnabled(False)
        self._run_worker(lambda: self.live_service.read_chip(self._port), self._write_target_finished)

    def _write_target_finished(self, result, exc: Exception | None) -> None:
        self.scan_target_button.setEnabled(True)
        if exc:
            self._scan_error(exc)
            return
        model = chip_read_view_model_from_live_result(result)
        self._target_scan = model if model.status not in {"error", "no_chip"} else None
        self._append_raw(result)
        self._render_write_plan()
        self._set_status("Schreibplan bereit" if model.profile else model.title)

    def _analysis_chip_scan(self) -> None:
        self.pages.setCurrentIndex(0)
        self.nav.setCurrentRow(0)
        self._scan_template_first()

    def _analysis_position_scan(self) -> None:
        self.pages.setCurrentIndex(0)
        self.nav.setCurrentRow(0)
        self._position_template()

    def _open_frequency_diagram(self) -> None:
        self._set_status("Diagramm wird geöffnet ...")
        try:
            launch = self.live_service.open_frequency_diagram(self._port)
        except Exception as exc:
            QMessageBox.warning(self, "Frequenzdiagramm", str(exc))
            self._set_status("Diagramm nicht verfügbar")
            return
        self._set_status(f"Diagramm geöffnet · {launch.port}")

    def _show_technical_details(self) -> None:
        dialog = QDialog(self)
        dialog.setWindowTitle("Technische Details")
        dialog.resize(760, 520)
        layout = QVBoxLayout(dialog)
        details = QPlainTextEdit()
        details.setReadOnly(True)
        details.setPlainText("\n\n".join(self._raw_log) if self._raw_log else "Noch keine technischen Details.")
        buttons = QDialogButtonBox(QDialogButtonBox.Close)
        buttons.rejected.connect(dialog.reject)
        layout.addWidget(details)
        layout.addWidget(buttons)
        dialog.exec()

    def _save_template_dialog(self) -> None:
        if self._validation is None or not self._validation.can_save:
            return
        dialog = QDialog(self)
        dialog.setWindowTitle("Vorlage speichern")
        layout = QVBoxLayout(dialog)
        title = QLineEdit()
        desc = QTextEdit()
        desc.setFixedHeight(90)
        buttons = QDialogButtonBox(QDialogButtonBox.Cancel | QDialogButtonBox.Save)
        buttons.rejected.connect(dialog.reject)
        buttons.accepted.connect(dialog.accept)
        layout.addWidget(QLabel("Titel"))
        layout.addWidget(title)
        layout.addWidget(QLabel("Beschreibung"))
        layout.addWidget(desc)
        layout.addWidget(buttons)
        if dialog.exec() != QDialog.Accepted:
            return
        try:
            path = save_confirmed_template(self._validation, title.text(), desc.toPlainText())
        except Exception as exc:
            QMessageBox.warning(self, "Vorlage speichern", str(exc))
            return
        self._set_status("Vorlage gespeichert")
        self.template_message.setText(f"Vorlage gespeichert: {path}")
        self._load_templates()

    def _render_start(self, model) -> None:
        self.start_title.setText(model.title)
        if model.connected and model.port:
            self.start_message.setText(f"{model.message}\n{model.port} · {model.target or 'PM3 Generic'}")
        else:
            self.start_message.setText(model.message)
        self.start_detail.setText(model.progress_label)
        self.start_progress.setRange(0, 1 if model.can_continue or model.can_retry else 0)
        self.start_progress.setValue(1 if model.can_continue else 0)
        self.start_progress.setVisible(not (model.can_continue or model.can_retry))
        self.start_state.setText("✓ Verbindung geprüft" if model.can_continue else "")
        self.retry_button.setVisible(model.can_retry)
        self.continue_button.setVisible(model.can_continue)

    def _render_prep(self, model) -> None:
        self.prep_title.setText(model.title)
        self.prep_message.setText(model.message)
        self.prep_button.setText(model.button_label)
        self.prep_detail.setText(f"LF: {model.lf_antenna_status} · HF: {model.hf_antenna_status}" if model.ready else "")
        self.prep_diagram.setText(model.diagram_message)
        self.prep_diagram_button.setEnabled(model.diagram_available)

    def _render_chip_read(self, model: ChipReadViewModel) -> None:
        extra_lines = [model.message]
        if model.next_step:
            extra_lines.append(model.next_step)
        extra_lines.extend(model.warnings)
        self.template_message.setText(f"{model.title}\n" + "\n".join(extra_lines))
        self._render_analysis_summary(model)
        visible_fields = list(model.fields)
        visible_fields.extend(model.public_configuration)
        visible_fields.extend(model.memory_sections)
        self._fill_field_table(self.template_table, [(field.label, field.value, field.note) for field in visible_fields])
        self.template_diff_table.setRowCount(0)
        show_details = bool(visible_fields) and model.status != "signal_unstable"
        self.template_table.setVisible(show_details)
        self.template_diff_table.hide()
        self.template_details_button.setVisible(model.status == "signal_unstable")
        self.template_graph_button.setVisible(model.status == "signal_unstable")
        self.template_graph_button.setEnabled(self.live_service.graph_viewer_available())
        self.position_button.setText("Weiter messen" if model.status == "signal_unstable" else "Position prüfen")
        self.scan_button.setText("Erneut scannen" if model.status in {"signal_unstable", "no_chip"} else "Chip scannen")
        if model.is_complete_template_read:
            self.second_scan_button.show()
            self._set_status("Chip erkannt")
        elif model.status in {"retry", "signal_unstable"}:
            self.second_scan_button.hide()
            self.save_template_button.hide()
            self._set_status("Signal instabil")
        elif model.status in {"identity_read", "public_details_read"}:
            self.second_scan_button.hide()
            self.save_template_button.hide()
            self._set_status("Chip gelesen · verfügbare Daten angezeigt")
        elif model.status in {"basic_detection", "detected_only", "read_requires_authorized_credentials", "read_not_supported_yet"}:
            self.second_scan_button.hide()
            self.save_template_button.hide()
            self._set_status("Chip erkannt · Basis-Erkennung")
        elif model.status == "no_chip":
            self.second_scan_button.hide()
            self.save_template_button.hide()
            self._set_status("Kein Chip erkannt")
        else:
            self.second_scan_button.hide()
            self.save_template_button.hide()
            self._set_status("Bereit")

    def _render_analysis_summary(self, model: ChipReadViewModel) -> None:
        if model.status == "signal_unstable":
            reasons = ", ".join(model.warnings) if model.warnings else "Signal nicht stabil"
            self.analysis_summary.setText(
                "Letzte Messung\n"
                "LF-Signal: vorhanden\n"
                "Identifikation: noch nicht stabil\n"
                "Empfehlung: Chip langsam mittig bewegen oder leicht drehen\n"
                f"Grund: {reasons}"
            )
        elif model.is_complete_template_read:
            self.analysis_summary.setText(
                "Letzte Messung\n"
                "Signal: stabil erkannt\n"
                f"Chipfamilie: {model.technology.technology_name if model.technology else 'erkannt'}"
            )
        elif model.status == "no_chip":
            self.analysis_summary.setText("Letzte Messung\nSignal: nicht erkannt")
        else:
            self.analysis_summary.setText(f"Letzte Messung\n{model.title}\n{model.message}")

    def _render_validation(self, validation: TemplateValidationViewModel) -> None:
        self.template_message.setText(("✓ " if validation.can_save else "") + validation.message)
        self.save_template_button.setVisible(validation.can_save)
        self.save_template_button.setEnabled(validation.can_save)
        rows = [(label, first, second) for label, first, second in validation.differences]
        self._fill_field_table(self.template_diff_table, rows)
        self.template_diff_table.setVisible(bool(rows))
        self._set_status("Zweiter Scan stimmt überein" if validation.can_save else "Bereit")

    def _render_write_plan(self) -> None:
        self._current_write_plan = None
        while self.disabled_actions.count():
            item = self.disabled_actions.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()
        self.plan_list.clear()
        self.compare_table.setRowCount(0)
        selected = self.template_list.currentRow()
        if selected < 0 or selected >= len(self._templates):
            self.write_message.setText("Wähle eine Vorlage und scanne einen Zielchip.")
            return
        if self._target_scan is None:
            self.write_message.setText("Vorlage gewählt. Scanne jetzt den Zielchip.")
            return
        if self._target_scan.profile is None:
            plan = unavailable_write_plan_view_model(self._target_scan)
            self.write_message.setText(plan.compatibility_message + "\n" + "\n".join(plan.summary_lines))
            return
        _, record = self._templates[selected]
        plan = build_write_plan_view_model(self._target_scan.profile, record)
        self._current_write_plan = plan
        self.write_message.setText(plan.compatibility_message + "\n" + "\n".join(plan.summary_lines))
        self.compare_table.setRowCount(len(plan.rows))
        for row_index, row in enumerate(plan.rows):
            values = [row.label, row.current_value, row.template_value, row.state, row.note]
            for col, value in enumerate(values):
                item = QTableWidgetItem(value)
                if row.state == "same":
                    item.setBackground(Qt.GlobalColor.darkGreen)
                elif row.state in {"different", "config"}:
                    item.setBackground(Qt.GlobalColor.darkYellow)
                elif row.state == "incompatible":
                    item.setBackground(Qt.GlobalColor.darkRed)
                elif row.state == "uid":
                    item.setBackground(Qt.GlobalColor.lightGray)
                self.compare_table.setItem(row_index, col, item)
        self.compare_table.resizeColumnsToContents()
        for step in plan.plan_steps:
            self.plan_list.addItem(step)
        for action in plan.disabled_actions:
            suffix = f"  ·  {action.reason}" if action.reason else ""
            button = QPushButton(f"{action.label}{suffix}")
            button.setEnabled(action.enabled and self.write_authorized.isChecked())
            if action.enabled and action.page is not None:
                button.clicked.connect(lambda checked=False, write_action=action: self._confirm_hitag_write(write_action))
            self.disabled_actions.addWidget(button)

    def _confirm_hitag_write(self, action) -> None:
        selected = self.template_list.currentRow()
        if selected < 0 or selected >= len(self._templates) or self._target_scan is None or self._target_scan.profile is None:
            return
        if not self.write_authorized.isChecked():
            QMessageBox.warning(self, "Schreiben", "Autorisierungsbestätigung ist erforderlich.")
            return
        if action.page is None:
            return
        label = "Konfiguration" if action.page == 1 else f"Block {action.page}"
        answer = QMessageBox.question(
            self,
            f"{label} schreiben",
            f"{label}\nAlter Wert: {action.old_value}\nNeuer Wert: {action.new_value}\n\nNach dem Schreiben wird sofort erneut gelesen und verifiziert.",
        )
        if answer != QMessageBox.Yes:
            return
        _, record = self._templates[selected]
        self._set_status(f"Schreibe {label} · Verifikation folgt")
        self.scan_target_button.setEnabled(False)
        self._run_worker(
            lambda: self.live_service.write_hitag_s256_page(
                action.page,
                action.old_value,
                action.new_value,
                record.template_id,
                self._target_scan.profile.uid,
                self._port,
            ),
            self._hitag_write_finished,
        )

    def _hitag_write_finished(self, result, exc: Exception | None) -> None:
        self.scan_target_button.setEnabled(True)
        if exc:
            QMessageBox.warning(self, "Schreiben", str(exc))
            self._set_status("Schreiben fehlgeschlagen")
            return
        if result.verify_result:
            self._append_raw(result.verify_result)
        if result.success:
            self._target_scan = chip_read_view_model_from_live_result(result.verify_result)
            self._set_status(f"Page {result.page} geschrieben und verifiziert")
        else:
            self._set_status(result.message)
            QMessageBox.warning(self, "Schreiben", result.message)
        self._render_write_plan()

    def _fill_field_table(self, table: QTableWidget, rows: list[tuple[str, str, str]]) -> None:
        table.setRowCount(len(rows))
        for row, values in enumerate(rows):
            for col, value in enumerate(values):
                table.setItem(row, col, QTableWidgetItem(value))
        table.resizeColumnsToContents()

    def _toggle_manual_frequency(self, enabled: bool) -> None:
        self.lf_button.setVisible(not enabled)
        self.hf_button.setVisible(not enabled)

    def _change_page(self, row: int) -> None:
        if row >= 0:
            self.pages.setCurrentIndex(row)

    def _load_templates(self) -> None:
        self._templates = list(load_template_records())
        self.template_list.clear()
        for path, record in self._templates:
            self.template_list.addItem(f"{record.title} · {record.technology_name} · {path.name}")
        if self._templates and self.template_list.currentRow() < 0:
            self.template_list.setCurrentRow(0)

    def _append_raw(self, result) -> None:
        for command_result in getattr(result, "raw_results", ()):
            text = "\n".join(part for part in (command_result.stdout, command_result.stderr) if part).strip()
            self._raw_log.append(f"$ {command_result.command}\n{text}")

    def _scan_error(self, exc: Exception) -> None:
        QMessageBox.warning(self, "Scan", str(exc))
        self._set_status("Verbindung verloren")

    def _show_help(self) -> None:
        QMessageBox.information(
            self,
            "Hilfe",
            "Diese Oberfläche führt nur autorisierte Read-only-Scans aus. Schreibaktionen sind sichtbar geplant, aber deaktiviert.",
        )

    def _set_status(self, text: str) -> None:
        self.bottom_status.setText(text)

    def _run_worker(self, callback, finished_callback) -> None:
        if self._worker_thread is not None:
            return
        thread = QThread(self)
        worker = _Worker(callback)
        worker.moveToThread(thread)
        thread.started.connect(worker.run)
        worker.finished.connect(finished_callback)
        worker.finished.connect(thread.quit)
        worker.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        thread.finished.connect(lambda: setattr(self, "_worker_thread", None))
        thread.finished.connect(lambda: setattr(self, "_worker", None))
        self._worker_thread = thread
        self._worker = worker
        thread.start()

    def _apply_style(self) -> None:
        self.setStyleSheet(
            """
            QWidget { background: #f6f7f9; color: #1f2933; font-size: 14px; }
            QFrame#centerPanel, QFrame#sectionPanel { background: #ffffff; border: 1px solid #d8e1ea; border-radius: 8px; }
            QLabel#heroIcon { font-size: 48px; color: #245d8f; }
            QLabel#startTitle { font-size: 30px; font-weight: 700; color: #102a43; }
            QLabel#startMessage { font-size: 18px; color: #263849; }
            QLabel#pageTitle { font-size: 24px; font-weight: 650; color: #102a43; }
            QLabel#cardTitle { font-size: 17px; font-weight: 650; }
            QLabel#headerLabel { color: #243b53; font-weight: 600; }
            QLabel#statusDot { color: #1f9d55; font-size: 18px; }
            QLabel#successText { color: #1f7a4d; font-weight: 650; }
            QLabel#muted { color: #5d6b78; }
            QLabel#messagePanel { padding: 10px 12px; background: #f4f7fb; border: 1px solid #d8e1ea; border-radius: 6px; color: #263849; }
            QLabel#statusBar { padding: 11px 18px; background: #e8eef4; color: #263849; font-weight: 600; }
            QListWidget#nav { background: #e8eef4; border: 0; padding: 10px; font-size: 15px; }
            QListWidget#nav::item { min-height: 50px; padding: 8px; border-radius: 7px; }
            QListWidget#nav::item:selected { background: #ffffff; color: #102a43; border-left: 4px solid #245d8f; }
            QPushButton { background: #eaf0f6; border: 1px solid #bdc9d5; border-radius: 6px; padding: 8px 12px; }
            QPushButton#smallButton { padding: 6px 10px; }
            QPushButton#primaryButton { background: #245d8f; color: #ffffff; font-size: 16px; padding: 12px 18px; }
            QPushButton:disabled { color: #73808c; background: #edf0f3; }
            QLineEdit, QTextEdit, QPlainTextEdit, QTableWidget, QListWidget { background: #ffffff; border: 1px solid #c7d2df; border-radius: 5px; }
            QFrame#toolCard { background: #ffffff; border: 1px solid #d6dee6; border-radius: 8px; padding: 8px; }
            QProgressBar { border: 1px solid #c7d2df; border-radius: 5px; text-align: center; background: #edf2f7; min-height: 12px; }
            QProgressBar::chunk { background: #2f80b7; border-radius: 5px; }
            """
        )


def _line() -> QFrame:
    frame = QFrame()
    frame.setFrameShape(QFrame.HLine)
    frame.setFrameShadow(QFrame.Plain)
    frame.setStyleSheet("color: #d6dee6;")
    return frame


def _polish_table(table: QTableWidget) -> None:
    table.setAlternatingRowColors(True)
    table.verticalHeader().setVisible(False)
    table.horizontalHeader().setStretchLastSection(True)
    table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeToContents)
    table.setSelectionBehavior(QAbstractItemView.SelectRows)
