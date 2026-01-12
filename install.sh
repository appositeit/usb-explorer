#!/bin/bash
# Install USB Explorer
# Creates a virtual environment and installs dependencies

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

echo "================================"
echo "USB Explorer - Installation"
echo "================================"
echo

# Check Python version
PYTHON_CMD=""
for cmd in python3.11 python3.10 python3.9 python3; do
    if command -v "$cmd" &> /dev/null; then
        version=$($cmd -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
        major=$(echo "$version" | cut -d. -f1)
        minor=$(echo "$version" | cut -d. -f2)
        if [ "$major" -ge 3 ] && [ "$minor" -ge 9 ]; then
            PYTHON_CMD="$cmd"
            break
        fi
    fi
done

if [ -z "$PYTHON_CMD" ]; then
    echo "Error: Python 3.9 or higher is required"
    echo "Please install Python 3.9+ and try again"
    exit 1
fi

echo "Using Python: $PYTHON_CMD ($($PYTHON_CMD --version))"
echo

# Check for system dependencies
echo "Checking system dependencies..."
MISSING_DEPS=""

# Check for libudev (required for pyudev)
if ! pkg-config --exists libudev 2>/dev/null; then
    MISSING_DEPS="$MISSING_DEPS libudev-dev"
fi

if [ -n "$MISSING_DEPS" ]; then
    echo
    echo "Warning: Some system dependencies may be missing:"
    echo "  $MISSING_DEPS"
    echo
    echo "On Debian/Ubuntu, install with:"
    echo "  sudo apt install$MISSING_DEPS"
    echo
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Create virtual environment
if [ -d "$VENV_DIR" ]; then
    echo "Virtual environment already exists at $VENV_DIR"
    read -p "Recreate it? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Removing existing virtual environment..."
        rm -rf "$VENV_DIR"
    fi
fi

if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    $PYTHON_CMD -m venv "$VENV_DIR"
fi

# Activate and install dependencies
echo "Installing dependencies..."
source "$VENV_DIR/bin/activate"
pip install --upgrade pip
pip install -r "$SCRIPT_DIR/requirements.txt"

# Create config from example if it doesn't exist
CONFIG_FILE="$SCRIPT_DIR/config/devices.yaml"
EXAMPLE_FILE="$SCRIPT_DIR/config/devices.yaml.example"

if [ ! -f "$CONFIG_FILE" ] && [ -f "$EXAMPLE_FILE" ]; then
    echo "Creating default configuration..."
    cp "$EXAMPLE_FILE" "$CONFIG_FILE"
fi

# Make scripts executable
echo "Setting up scripts..."
chmod +x "$SCRIPT_DIR/bin/"*

# Update start script to use venv
WRAPPER_SCRIPT="$SCRIPT_DIR/usb-debug"
cat > "$WRAPPER_SCRIPT" << 'EOF'
#!/bin/bash
# USB Explorer launcher
# Activates the virtual environment and starts the server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

if [ ! -d "$VENV_DIR" ]; then
    echo "Error: Virtual environment not found. Please run install.sh first."
    exit 1
fi

source "$VENV_DIR/bin/activate"
exec "$SCRIPT_DIR/bin/start_usb_debug" "$@"
EOF
chmod +x "$WRAPPER_SCRIPT"

echo
echo "================================"
echo "Installation complete!"
echo "================================"
echo
echo "To start the USB Explorer:"
echo "  ./usb-debug"
echo
echo "Or with root privileges (for device reset feature):"
echo "  sudo ./usb-debug"
echo
echo "The web interface will open at http://localhost:8080"
echo
echo "Other commands:"
echo "  ./bin/stop_usb_debug    - Stop the server"
echo "  ./bin/restart_usb_debug - Restart the server"
echo "  ./bin/isalive_usb_debug - Check if server is running"
echo
