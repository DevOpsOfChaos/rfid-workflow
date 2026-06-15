"""Source-tree shim for ``python -m pm3_workflow_gui...`` without install.

The actual package lives under ``src/pm3_workflow_gui``. This keeps direct
module execution from the repository root working for local diagnostics.
"""

from pathlib import Path
from pkgutil import extend_path

__path__ = extend_path(__path__, __name__)

_src_package = Path(__file__).resolve().parent.parent / "src" / "pm3_workflow_gui"
if _src_package.exists():
    __path__.append(str(_src_package))

__all__ = ["__version__"]
__version__ = "0.1.0"
