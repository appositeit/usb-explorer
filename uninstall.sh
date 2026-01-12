#!/bin/bash
# Uninstall USB Explorer
# Removes the virtual environment and cleans up

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

echo "================================"
echo "USB Explorer - Uninstall"
echo "================================"
echo

# Stop the server if running
if [ -x "$SCRIPT_DIR/bin/stop_usb_debug" ]; then
    echo "Stopping server if running..."
    "$SCRIPT_DIR/bin/stop_usb_debug" 2>/dev/null || true
fi

# Remove virtual environment
if [ -d "$VENV_DIR" ]; then
    echo "Removing virtual environment..."
    rm -rf "$VENV_DIR"
else
    echo "Virtual environment not found (already removed?)"
fi

# Remove launcher script
if [ -f "$SCRIPT_DIR/usb-debug" ]; then
    echo "Removing launcher script..."
    rm -f "$SCRIPT_DIR/usb-debug"
fi

# Ask about config
CONFIG_FILE="$SCRIPT_DIR/config/devices.yaml"
if [ -f "$CONFIG_FILE" ]; then
    echo
    read -p "Remove your configuration (devices.yaml)? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -f "$CONFIG_FILE"
        echo "Configuration removed."
    else
        echo "Configuration preserved at: $CONFIG_FILE"
    fi
fi

# Clean up __pycache__
echo "Cleaning up Python cache..."
find "$SCRIPT_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$SCRIPT_DIR" -type f -name "*.pyc" -delete 2>/dev/null || true

echo
echo "================================"
echo "Uninstall complete!"
echo "================================"
echo
echo "The USB Explorer has been removed."
echo "Source code remains in: $SCRIPT_DIR"
echo
echo "To reinstall, run: ./install.sh"
echo
