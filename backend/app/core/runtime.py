"""Process-owned services wired once by bootstrap, shared by HTTP and WS routes."""
from types import SimpleNamespace

# Importing route modules never starts hardware, a model or database connections.
runtime = SimpleNamespace(camera_manager=None, video_analyzer=None, manager=None, main_loop=None)
