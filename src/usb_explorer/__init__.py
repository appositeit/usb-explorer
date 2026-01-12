"""
USB Explorer - Visual USB topology and debugging for Linux.

A web-based tool for visualising USB device topology, monitoring plug/unplug
events, and debugging USB connectivity issues.
"""

__version__ = "0.1.1"
__all__ = ["run_server"]

from .main import run_server
