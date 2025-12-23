# USB Debug Tool

Real-time USB device monitoring and debugging for Linux.

## Quick Start

```bash
# Start the tool (requires sudo for full functionality)
sudo ./bin/start_usb_debug

# The browser will open automatically to http://localhost:8080
```

## Features

- **Live Device Tree**: Visual representation of USB topology
- **Real-time Updates**: Instant notification of device changes
- **Error Detection**: Automatic parsing of dmesg for USB errors
- **Audio Alerts**: Sound notifications for plug/unplug events
- **Device Reset**: Reset problematic devices from the UI
- **Custom Names**: Label your devices for easy identification

## Requirements

- Python 3.10+
- Linux with udev
- Root/sudo access (for device reset and full USB info)

## Installation

```bash
# Clone and enter directory
cd /path/to/fix_usb_hubs

# Install dependencies
pip install -r requirements.txt

# Make scripts executable
chmod +x bin/*
```

## Usage

### Start Server
```bash
# With browser auto-open (default)
sudo ./bin/start_usb_debug

# Without browser
USB_DEBUG_OPEN_BROWSER=0 sudo ./bin/start_usb_debug

# Custom port
USB_DEBUG_PORT=9000 sudo ./bin/start_usb_debug
```

### Stop Server
```bash
./bin/stop_usb_debug
```

### Check Status
```bash
./bin/isalive_usb_debug
```

## Configuration

Edit `config/devices.yaml` to add custom device names:

```yaml
devices:
  - vendor_id: "05e3"
    product_id: "0610"
    custom_name: "Main USB Hub"
    notes: "Connected to monitor"
```

## Keyboard Shortcuts

- **Click device**: View device details
- **Refresh button**: Reload device tree

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Main UI |
| `/ws` | WebSocket | Real-time updates |
| `/api/devices` | GET | Device tree JSON |
| `/api/device/{path}` | GET | Single device info |
| `/api/device/{path}/reset` | POST | Reset device |
| `/api/errors` | GET | Recent USB errors |
| `/api/health` | GET | Health check |

## Troubleshooting

### "Permission denied" errors
Run with sudo: `sudo ./bin/start_usb_debug`

### No devices showing
- Ensure pyudev is installed: `pip install pyudev`
- Check udev is running: `systemctl status udev`

### WebSocket disconnects
- Check firewall allows port 8080
- Try a different browser
