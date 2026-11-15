"""Replace a package module and its parent binding together during isolated imports."""
from contextlib import ExitStack, contextmanager
import importlib
import sys
from unittest.mock import patch


@contextmanager
def module_mocks(modules):
    with ExitStack() as stack:
        for name, replacement in modules.items():
            parent, _, child = name.rpartition(".")
            if parent:
                package = importlib.import_module(parent)
                stack.enter_context(patch.object(package, child, replacement, create=True))
        stack.enter_context(patch.dict(sys.modules, modules))
        yield
