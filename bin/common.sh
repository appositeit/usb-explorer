#!/bin/bash
# Common configuration for USB Explorer scripts

# Script locations
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Runtime directory - use XDG_RUNTIME_DIR if available, fall back to /tmp
if [ -n "$XDG_RUNTIME_DIR" ] && [ -d "$XDG_RUNTIME_DIR" ]; then
    RUNTIME_DIR="$XDG_RUNTIME_DIR"
else
    RUNTIME_DIR="/tmp"
fi

# PID file location (can be overridden via environment)
PID_FILE="${USB_EXPLORER_PID_FILE:-${USB_DEBUG_PID_FILE:-$RUNTIME_DIR/usb_explorer.pid}}"

# Default settings (can be overridden via environment)
USB_DEBUG_HOST="${USB_DEBUG_HOST:-0.0.0.0}"
USB_DEBUG_PORT="${USB_DEBUG_PORT:-8080}"
USB_DEBUG_OPEN_BROWSER="${USB_DEBUG_OPEN_BROWSER:-1}"
