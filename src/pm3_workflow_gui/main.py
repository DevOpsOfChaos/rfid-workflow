def main() -> int:
    from pm3_workflow_gui.web_desktop.app import main as app_main

    app_main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
