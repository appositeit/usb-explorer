"""
CLI entry point for USB Explorer.

Allows running with: python -m usb_explorer
"""

import os
import sys


def main():
    """Main entry point for the USB Explorer CLI."""
    from .main import run_server

    port = int(os.environ.get("USB_EXPLORER_PORT", os.environ.get("USB_DEBUG_PORT", "8080")))
    host = os.environ.get("USB_EXPLORER_HOST", os.environ.get("USB_DEBUG_HOST", "0.0.0.0"))
    open_browser = os.environ.get("USB_EXPLORER_OPEN_BROWSER", os.environ.get("USB_DEBUG_OPEN_BROWSER", "1")).lower() not in ("0", "false", "no")

    run_server(host=host, port=port, open_browser=open_browser)


if __name__ == "__main__":
    main()
