import asyncio
import importlib
import py_compile
import re
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"


class DummyModule(types.ModuleType):
    def __init__(self, name: str):
        super().__init__(name)
        self.__path__ = []

    def __getattr__(self, item: str):
        if item.startswith("__"):
            raise AttributeError(item)
        full_name = f"{self.__name__}.{item}"
        mod = _ensure_dummy_module(full_name)
        setattr(self, item, mod)
        return mod

    def __call__(self, *args, **kwargs):
        return self

    def __iter__(self):
        return iter(())

    def __len__(self):
        return 0


def _ensure_dummy_module(name: str):
    if name in sys.modules:
        return sys.modules[name]
    mod = DummyModule(name)
    sys.modules[name] = mod
    if "." in name:
        parent_name, child_name = name.rsplit(".", 1)
        parent = _ensure_dummy_module(parent_name)
        setattr(parent, child_name, mod)
    return mod


class _DummyTask:
    def cancel(self):
        return None

    def done(self):
        return True


class _DummyLoop:
    def create_task(self, coro):
        if hasattr(coro, "close"):
            coro.close()
        return _DummyTask()


def _safe_create_task(coro):
    if hasattr(coro, "close"):
        coro.close()
    return _DummyTask()


def _to_dotted_module(path: Path) -> str:
    rel = path.relative_to(ROOT).with_suffix("")
    return ".".join(rel.parts)


def _iter_src_py_files():
    files = []
    for path in SRC.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        files.append(path)
    return sorted(files)


MODULE_FILES = _iter_src_py_files()
MODULE_DOTTED = [_to_dotted_module(p) for p in MODULE_FILES]


def _import_with_auto_stubs(module_name: str, max_attempts: int = 15):
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))

    importlib.invalidate_caches()
    sys.modules.pop(module_name, None)

    for _ in range(max_attempts):
        try:
            return importlib.import_module(module_name)
        except ModuleNotFoundError as exc:
            missing = exc.name
            if not missing:
                raise
            # Local source modules should exist and should not be faked.
            if missing.startswith("src."):
                raise
            _ensure_dummy_module(missing)
        except ImportError as exc:
            msg = str(exc)
            match = re.search(r"cannot import name '([^']+)' from '([^']+)'", msg)
            if not match:
                raise
            attr, parent_name = match.groups()
            parent = sys.modules.get(parent_name)
            if parent is None:
                parent = _ensure_dummy_module(parent_name)
            setattr(parent, attr, _ensure_dummy_module(f"{parent_name}.{attr}"))

    raise AssertionError(f"Unable to import {module_name} after {max_attempts} attempts")


@pytest.mark.parametrize("module_file", MODULE_FILES, ids=[str(p.relative_to(ROOT)) for p in MODULE_FILES])
def test_all_src_files_compile(module_file: Path):
    py_compile.compile(str(module_file), doraise=True)


@pytest.mark.parametrize("module_name", MODULE_DOTTED, ids=MODULE_DOTTED)
def test_all_src_modules_import(module_name: str, monkeypatch):
    monkeypatch.setattr(asyncio, "create_task", _safe_create_task)
    monkeypatch.setattr(asyncio, "get_running_loop", lambda: _DummyLoop())
    _import_with_auto_stubs(module_name)
