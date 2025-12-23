# USB Debug Tool - Project Overview

## Problem Statement

Debugging USB connectivity issues on Linux systems is challenging:
- Hard to visualise device topology
- Difficult to track plug/unplug events in real-time
- Error messages in dmesg are scattered and hard to correlate
- No easy way to identify problematic devices or ports

## Solution

A web-based USB debugging tool that provides:
- **Real-time device tree visualisation** using D3.js
- **Live event monitoring** via WebSocket push updates
- **Error tracking** by parsing dmesg for USB-related errors
- **Audio notifications** for plug/unplug events
- **Device reset capability** from the UI
- **Custom device naming** for easier identification

## Architecture

```
Browser (Frontend)
    │
    ├── D3.js Tree Visualisation
    ├── Device Info Panel
    └── Event Log
    │
    └── WebSocket Connection
            │
            ▼
FastAPI Server (Backend)
    │
    ├── WebSocket Manager (broadcasts events)
    ├── USB Monitor (pyudev, real-time monitoring)
    ├── dmesg Parser (error detection)
    └── Config Manager (YAML, custom names)
```

## Technology Stack

- **Backend**: Python 3, FastAPI, uvicorn
- **Real-time**: WebSocket (python-socketio)
- **USB Monitoring**: pyudev (Linux udev bindings)
- **Frontend**: HTML5, CSS3, vanilla JavaScript
- **Visualisation**: D3.js v7
- **Icons**: Lucide Icons (MIT licensed)
- **Configuration**: YAML

## Key Features

### MVP (v0.1)
- [x] Live WebSocket updates
- [x] D3.js device tree
- [x] Device info panel
- [x] Event log with colours
- [x] Audio notifications
- [x] Custom device naming
- [x] Error indicators
- [x] Device reset button
- [x] Dark mode

### Future Enhancements
- [ ] Real-time bandwidth monitoring
- [ ] Connection history/timeline
- [ ] Expected state configuration
- [ ] Multi-machine support (SSH)
- [ ] Export diagnostics report
