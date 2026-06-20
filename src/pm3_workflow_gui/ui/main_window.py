from __future__ import annotations

from pathlib import Path

from pm3_workflow_gui.ui.viewmodel import (
    DEFAULT_LOG_DIR,
    RECOMMENDED_START_COMMAND,
    DiscoveryViewModel,
    demo_sources,
    load_live_scan_view_model,
    load_demo_view_model,
    load_latest_log_view_model,
    load_log_view_model,
)
from pm3_workflow_gui.services.live_pm3_readonly import (
    DEVICE_RECONNECT_MESSAGE,
    LivePm3ReadonlyService,
)


try:
    from PySide6.QtCore import QObject, QThread, QTimer, Qt, Signal
    from PySide6.QtWidgets import (
        QComboBox,
        QFileDialog,
        QFormLayout,
        QGroupBox,
        QHBoxLayout,
        QLabel,
        QLineEdit,
        QListWidget,
        QMainWindow,
        QMessageBox,
        QPushButton,
        QPlainTextEdit,
        QStackedLayout,
        QSplitter,
        QVBoxLayout,
        QWidget,
    )
except ImportError as exc:  # pragma: no cover - exercised only when launching without PySide6
    raise RuntimeError(
        "PySide6 is not installed. Create and activate .venv-gui, then install PySide6."
    ) from exc


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
        self.setWindowTitle("PM3 Workflow - Read-only Discovery")
        self.resize(1120, 760)
        self.live_service = LivePm3ReadonlyService()
        self._worker_thread: QThread | None = None
        self._worker: _Worker | None = None
        self._pending_live_scan = False

        self.source_combo = QComboBox()
        for source in demo_sources():
            self.source_combo.addItem(source.label)
        self.load_scenario_button = QPushButton("Load scenario")
        self.open_log_button = QPushButton("Open PM3 log...")
        self.latest_log_dir = QLineEdit(str(DEFAULT_LOG_DIR))
        self.load_latest_button = QPushButton("Load latest PM3 log")
        self.live_scan_button = QPushButton("Scan NFC/RFID tag")
        self.current_source = QLabel("No source loaded")
        self.start_command = QPlainTextEdit(RECOMMENDED_START_COMMAND)
        self.start_command.setReadOnly(True)
        self.console_hint = QLabel("Run CLI commands in a separate PowerShell, not in the PM3 console.")
        self.write_disabled = QPushButton("Write disabled in this build")
        self.write_disabled.setEnabled(False)

        self.status_title = QLabel("No data loaded")
        self.status_title.setObjectName("statusTitle")
        self.session_status = QLabel("unknown")
        self.reconnect_required = QLabel("no")
        self.next_step = QLabel("Load a scenario or PM3 log")
        self.next_step.setWordWrap(True)

        self.hardware_fields = {
            "Target": QLabel("unknown"),
            "Client": QLabel("unknown"),
            "COM port": QLabel("unknown/auto"),
            "Firmware": QLabel("unknown"),
            "LF antenna": QLabel("unknown"),
            "HF antenna": QLabel("unknown"),
        }
        self.tag_fields = {
            "Discovery data": QLabel("unknown"),
            "Frequency": QLabel("unknown"),
            "Type": QLabel("unknown"),
            "Verification": QLabel("not_run"),
        }
        self.last_error = QLabel("none")
        self.last_error.setWordWrap(True)
        self.failed_commands = QListWidget()
        self.risk_notes = QListWidget()
        self.recognized_commands = QListWidget()
        self.ignored_host_commands = QListWidget()
        self.missing_sections = QListWidget()
        self.reconnect_overlay = self._reconnect_overlay()
        self.reconnect_poll_timer = QTimer(self)
        self.reconnect_poll_timer.setInterval(2000)

        self._build_layout()
        self._connect_signals()
        self._apply_style()
        self._load_initial_demo()

    def _build_layout(self) -> None:
        root = QSplitter(Qt.Horizontal)
        root.addWidget(self._source_panel())
        root.addWidget(self._summary_panel())
        root.setSizes([330, 790])

        container = QWidget()
        stack = QStackedLayout(container)
        stack.setStackingMode(QStackedLayout.StackAll)
        stack.addWidget(root)
        stack.addWidget(self.reconnect_overlay)
        self.reconnect_overlay.hide()
        self.setCentralWidget(container)

    def _source_panel(self) -> QWidget:
        panel = QWidget()
        layout = QVBoxLayout(panel)

        source_box = QGroupBox("Data source")
        source_layout = QVBoxLayout(source_box)
        source_layout.addWidget(self.source_combo)
        source_layout.addWidget(self.load_scenario_button)
        source_layout.addWidget(self.open_log_button)
        source_layout.addWidget(QLabel("Latest log directory"))
        source_layout.addWidget(self.latest_log_dir)
        source_layout.addWidget(self.load_latest_button)
        source_layout.addWidget(self.live_scan_button)
        source_layout.addWidget(QLabel("Current source"))
        source_layout.addWidget(self.current_source)

        start_box = QGroupBox("PM3 start command")
        start_layout = QVBoxLayout(start_box)
        start_layout.addWidget(self.start_command)
        start_layout.addWidget(self.console_hint)
        start_layout.addWidget(self.write_disabled)

        layout.addWidget(source_box)
        layout.addWidget(start_box)
        layout.addStretch(1)
        return panel

    def _summary_panel(self) -> QWidget:
        panel = QWidget()
        layout = QVBoxLayout(panel)
        layout.addWidget(self._status_box())
        layout.addLayout(self._cards_row())
        layout.addLayout(self._lists_row())
        layout.addWidget(self._debug_box())
        return panel

    def _reconnect_overlay(self) -> QWidget:
        overlay = QWidget()
        overlay.setObjectName("reconnectOverlay")
        layout = QVBoxLayout(overlay)
        layout.setAlignment(Qt.AlignCenter)

        title = QLabel("Proxmark not found")
        title.setObjectName("overlayTitle")
        title.setAlignment(Qt.AlignCenter)
        message = QLabel(
            "Disconnect the Proxmark USB cable briefly, plug it back in, and wait here.\n"
            "This screen closes automatically when the PM3 wrapper finds a connection."
        )
        message.setObjectName("overlayMessage")
        message.setAlignment(Qt.AlignCenter)
        message.setWordWrap(True)
        detail = QLabel(DEVICE_RECONNECT_MESSAGE)
        detail.setObjectName("overlayDetail")
        detail.setAlignment(Qt.AlignCenter)
        detail.setWordWrap(True)

        layout.addWidget(title)
        layout.addWidget(message)
        layout.addWidget(detail)
        return overlay

    def _status_box(self) -> QGroupBox:
        box = QGroupBox("Status")
        layout = QFormLayout(box)
        layout.addRow(self.status_title)
        layout.addRow("Session status", self.session_status)
        layout.addRow("Reconnect required", self.reconnect_required)
        layout.addRow("Next step", self.next_step)
        return box

    def _cards_row(self) -> QHBoxLayout:
        row = QHBoxLayout()
        row.addWidget(self._form_box("Hardware", self.hardware_fields))
        row.addWidget(self._form_box("Tag", self.tag_fields))
        return row

    def _lists_row(self) -> QHBoxLayout:
        row = QHBoxLayout()
        error_box = QGroupBox("Errors")
        error_layout = QVBoxLayout(error_box)
        error_layout.addWidget(QLabel("Last error"))
        error_layout.addWidget(self.last_error)
        error_layout.addWidget(QLabel("Failed commands"))
        error_layout.addWidget(self.failed_commands)

        risk_box = QGroupBox("Risk notes")
        risk_layout = QVBoxLayout(risk_box)
        risk_layout.addWidget(self.risk_notes)

        row.addWidget(error_box)
        row.addWidget(risk_box)
        return row

    def _debug_box(self) -> QGroupBox:
        box = QGroupBox("Debug")
        layout = QHBoxLayout(box)
        layout.addWidget(self._list_box("Recognized PM3 commands", self.recognized_commands))
        layout.addWidget(self._list_box("Ignored host commands", self.ignored_host_commands))
        layout.addWidget(self._list_box("Missing sections", self.missing_sections))
        return box

    def _form_box(self, title: str, fields: dict[str, QLabel]) -> QGroupBox:
        box = QGroupBox(title)
        layout = QFormLayout(box)
        for label, widget in fields.items():
            widget.setWordWrap(True)
            layout.addRow(label, widget)
        return box

    def _list_box(self, title: str, widget: QListWidget) -> QGroupBox:
        box = QGroupBox(title)
        layout = QVBoxLayout(box)
        layout.addWidget(widget)
        return box

    def _connect_signals(self) -> None:
        self.load_scenario_button.clicked.connect(self._load_selected_demo)
        self.open_log_button.clicked.connect(self._open_log)
        self.load_latest_button.clicked.connect(self._load_latest_log)
        self.live_scan_button.clicked.connect(self._start_live_scan)
        self.reconnect_poll_timer.timeout.connect(self._poll_reconnect)

    def _load_initial_demo(self) -> None:
        if self.source_combo.count():
            self._load_selected_demo()

    def _load_selected_demo(self) -> None:
        self._load(lambda: load_demo_view_model(self.source_combo.currentText()))

    def _open_log(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Open PM3 log", str(DEFAULT_LOG_DIR), "Text logs (*.txt);;All files (*.*)")
        if path:
            self._load(lambda: load_log_view_model(Path(path)))

    def _load_latest_log(self) -> None:
        self._load(lambda: load_latest_log_view_model(Path(self.latest_log_dir.text())))

    def _start_live_scan(self) -> None:
        self._pending_live_scan = False
        self._set_busy(True, "Scanning live PM3...")
        self._run_worker(lambda: load_live_scan_view_model(self.live_service), self._live_scan_finished)

    def _live_scan_finished(self, model: DiscoveryViewModel | None, exc: Exception | None) -> None:
        self._set_busy(False)
        if exc:
            QMessageBox.warning(self, "Live scan failed", str(exc))
            return
        if model is None:
            return
        self._render(model)
        if model.reconnect_required:
            self._pending_live_scan = True
            self._show_reconnect_overlay()

    def _show_reconnect_overlay(self) -> None:
        self.reconnect_overlay.show()
        self.reconnect_overlay.raise_()
        if not self.reconnect_poll_timer.isActive():
            self.reconnect_poll_timer.start()

    def _hide_reconnect_overlay(self) -> None:
        self.reconnect_poll_timer.stop()
        self.reconnect_overlay.hide()

    def _poll_reconnect(self) -> None:
        if self._worker_thread is not None:
            return
        self._run_worker(self.live_service.connection_status, self._poll_reconnect_finished)

    def _poll_reconnect_finished(self, status, exc: Exception | None) -> None:
        if exc or not status or not status.connected:
            return
        self._hide_reconnect_overlay()
        if self._pending_live_scan:
            self._pending_live_scan = False
            self._start_live_scan()

    def _load(self, loader) -> None:
        try:
            model = loader()
        except Exception as exc:  # pragma: no cover - UI error path
            QMessageBox.warning(self, "Unable to load source", str(exc))
            return
        self._render(model)

    def _render(self, model: DiscoveryViewModel) -> None:
        self.current_source.setText(model.source_path or model.source)
        self.status_title.setText(model.title)
        self.session_status.setText(model.session_status)
        self.reconnect_required.setText("yes" if model.reconnect_required else "no")
        self.next_step.setText(model.primary_action_hint)
        self.last_error.setText(model.last_error or "none")

        self.hardware_fields["Target"].setText(model.target)
        self.hardware_fields["Client"].setText(model.client)
        self.hardware_fields["COM port"].setText(model.com_port)
        self.hardware_fields["Firmware"].setText(model.firmware)
        self.hardware_fields["LF antenna"].setText(model.lf_antenna_status)
        self.hardware_fields["HF antenna"].setText(model.hf_antenna_status)
        self.tag_fields["Discovery data"].setText(model.discovery_data_status)
        self.tag_fields["Frequency"].setText(model.tag_frequency)
        self.tag_fields["Type"].setText(model.tag_type)
        self.tag_fields["Verification"].setText(model.verification_status)

        self._fill_list(self.failed_commands, model.failed_commands)
        self._fill_list(self.risk_notes, model.risk_notes)
        self._fill_list(self.recognized_commands, model.recognized_pm3_commands)
        self._fill_list(self.ignored_host_commands, model.ignored_host_commands)
        self._fill_list(self.missing_sections, model.missing_sections)

    def _set_busy(self, busy: bool, message: str | None = None) -> None:
        for widget in (
            self.load_scenario_button,
            self.open_log_button,
            self.load_latest_button,
            self.live_scan_button,
        ):
            widget.setEnabled(not busy)
        if message:
            self.current_source.setText(message)

    def _run_worker(self, callback, finished_callback) -> None:
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

    def _fill_list(self, widget: QListWidget, values: tuple[str, ...]) -> None:
        widget.clear()
        for value in values or ("none",):
            widget.addItem(value)

    def _apply_style(self) -> None:
        self.setStyleSheet(
            """
            QWidget { background: #f7f8fa; color: #1f2933; font-size: 13px; }
            QGroupBox { background: #ffffff; border: 1px solid #d8dee6; border-radius: 6px; margin-top: 10px; padding: 10px; }
            QGroupBox::title { subcontrol-origin: margin; left: 10px; padding: 0 4px; color: #52606d; }
            QPushButton { background: #e8eef5; border: 1px solid #c7d2df; border-radius: 5px; padding: 7px 10px; }
            QPushButton:disabled { color: #7b8794; background: #edf0f3; }
            QLineEdit, QPlainTextEdit, QListWidget { background: #ffffff; border: 1px solid #c7d2df; border-radius: 5px; padding: 5px; }
            QLabel#statusTitle { font-size: 22px; font-weight: 600; color: #102a43; }
            QWidget#reconnectOverlay { background: #fff7ed; border: 4px solid #c2410c; }
            QLabel#overlayTitle { font-size: 34px; font-weight: 700; color: #7c2d12; }
            QLabel#overlayMessage { font-size: 19px; color: #431407; padding: 18px; }
            QLabel#overlayDetail { font-size: 15px; color: #7c2d12; }
            """
        )
