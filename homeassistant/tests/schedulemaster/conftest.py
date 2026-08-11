"""Load the component's dependency-light modules without Home Assistant.

const/models/logic import nothing from HA, so we load them under a synthetic
package name (making their ``from .x import`` resolve) rather than importing the
real package, whose ``__init__`` pulls in homeassistant. ``api`` is loaded too
when aiohttp is available (for the live smoke test).
"""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

# .../homeassistant/tests/schedulemaster/conftest.py -> the component dir.
COMP = Path(__file__).resolve().parents[2] / "custom_components" / "schedulemaster"
PKG = "sm_under_test"


def _load_module(name: str) -> None:
    spec = importlib.util.spec_from_file_location(f"{PKG}.{name}", COMP / f"{name}.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[f"{PKG}.{name}"] = mod
    spec.loader.exec_module(mod)


def _bootstrap() -> None:
    if PKG in sys.modules:
        return
    pkg = types.ModuleType(PKG)
    pkg.__path__ = [str(COMP)]  # type: ignore[attr-defined]
    sys.modules[PKG] = pkg
    for name in ("const", "models", "logic"):
        _load_module(name)
    try:
        import aiohttp  # noqa: F401
    except ImportError:
        pass
    else:
        _load_module("api")


_bootstrap()
