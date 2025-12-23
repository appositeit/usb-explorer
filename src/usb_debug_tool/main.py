"""
USB Debug Tool - FastAPI Application.

Main entry point for the web server providing real-time USB monitoring.
"""

from __future__ import annotations
import asyncio
import logging
import os
import signal
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.requests import Request
from fastapi.responses import JSONResponse

from .models import USBEvent, EventType
from .usb_monitor import USBMonitor
from .dmesg_parser import DmesgMonitor, get_errors_for_device, get_recent_usb_errors
from .config_manager import get_config_manager, ConfigManager
from .websocket_manager import get_ws_manager, WebSocketManager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

# Global instances
usb_monitor: USBMonitor | None = None
dmesg_monitor: DmesgMonitor | None = None
config_manager: ConfigManager | None = None
ws_manager: WebSocketManager | None = None
main_loop: asyncio.AbstractEventLoop | None = None

# Background tasks
_background_tasks: list[asyncio.Task] = []


def handle_usb_event(event: USBEvent) -> None:
    """Handle USB events from the monitor (called from background thread)."""
    if main_loop is None or ws_manager is None:
        return

    # Schedule the coroutine on the main event loop from this background thread
    main_loop.call_soon_threadsafe(
        lambda: main_loop.create_task(ws_manager.broadcast_event(event))
    )


def handle_dmesg_error(error: Any) -> None:
    """Handle dmesg errors (called from background thread)."""
    from .dmesg_parser import USBError
    if not isinstance(error, USBError):
        return

    if main_loop is None or ws_manager is None:
        return

    # Create error event
    event = USBEvent(
        type=EventType.DEVICE_ERROR,
        port_path=error.port_path,
        error_message=error.message,
    )

    # Schedule the coroutine on the main event loop from this background thread
    main_loop.call_soon_threadsafe(
        lambda e=event: main_loop.create_task(ws_manager.broadcast_event(e))
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    global usb_monitor, dmesg_monitor, config_manager, ws_manager, main_loop

    logger.info("Starting USB Debug Tool...")

    # Store the main event loop for use in background thread callbacks
    main_loop = asyncio.get_running_loop()

    # Initialise components
    config_manager = get_config_manager()
    ws_manager = get_ws_manager()

    usb_monitor = USBMonitor(config_manager.get_device_lookup())
    usb_monitor.register_callback(handle_usb_event)

    dmesg_monitor = DmesgMonitor()
    dmesg_monitor.register_callback(handle_dmesg_error)

    # Start background monitoring tasks
    usb_task = asyncio.create_task(usb_monitor.start_monitoring())
    dmesg_task = asyncio.create_task(dmesg_monitor.start_monitoring())
    _background_tasks.extend([usb_task, dmesg_task])

    logger.info("USB Debug Tool started successfully")

    yield

    # Shutdown
    logger.info("Shutting down USB Debug Tool...")

    usb_monitor.stop_monitoring()
    dmesg_monitor.stop_monitoring()

    for task in _background_tasks:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    logger.info("USB Debug Tool stopped")


# Create FastAPI app
app = FastAPI(
    title="USB Debug Tool",
    description="Real-time USB device monitoring and debugging",
    version="0.1.0",
    lifespan=lifespan,
)

# Mount static files
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Templates
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@app.get("/")
async def index(request: Request):
    """Serve the main page."""
    return templates.TemplateResponse("index.html", {"request": request})


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates."""
    await ws_manager.connect(websocket)  # type: ignore

    try:
        # Send initial device tree
        devices = usb_monitor.get_tree()  # type: ignore

        # Add errors to devices
        errors = get_recent_usb_errors(200)
        for device in devices:
            _add_errors_to_tree(device, errors)

        initial_event = USBEvent(
            type=EventType.FULL_TREE,
            devices=devices,
        )
        await websocket.send_json(initial_event.to_websocket_message())

        # Keep connection alive and handle incoming messages
        while True:
            try:
                data = await websocket.receive_json()
                await handle_client_message(websocket, data)
            except WebSocketDisconnect:
                break

    except Exception as e:
        logger.exception(f"WebSocket error: {e}")
    finally:
        await ws_manager.disconnect(websocket)  # type: ignore


def _add_errors_to_tree(device: Any, errors: list) -> None:
    """Recursively add errors to device tree."""
    device.errors = get_errors_for_device(device.port_path, errors)
    device.has_errors = len(device.errors) > 0
    for child in device.children:
        _add_errors_to_tree(child, errors)


async def handle_client_message(websocket: WebSocket, data: dict) -> None:
    """Handle messages from WebSocket clients."""
    action = data.get("action")

    if action == "refresh":
        # Send fresh device tree
        devices = usb_monitor.get_tree()  # type: ignore
        errors = get_recent_usb_errors(200)
        for device in devices:
            _add_errors_to_tree(device, errors)

        event = USBEvent(type=EventType.FULL_TREE, devices=devices)
        await websocket.send_json(event.to_websocket_message())

    elif action == "set_name":
        vendor_id = data.get("vendor_id")
        product_id = data.get("product_id")
        name = data.get("name")

        if vendor_id and product_id and name:
            config_manager.set_device_name(vendor_id, product_id, name)  # type: ignore
            # Update USB monitor's lookup
            usb_monitor.config_lookup = config_manager.get_device_lookup()  # type: ignore
            await websocket.send_json({"type": "name_updated", "success": True})

    elif action == "reset_device":
        port_path = data.get("port_path")
        if port_path:
            success = await reset_usb_device(port_path)
            await websocket.send_json({"type": "reset_result", "success": success, "port_path": port_path})


async def reset_usb_device(port_path: str) -> bool:
    """Reset a USB device by toggling its authorized state."""
    try:
        # Find the device's sysfs path
        base_path = Path(f"/sys/bus/usb/devices/{port_path}")

        if not base_path.exists():
            logger.warning(f"Device path not found: {base_path}")
            return False

        authorized_path = base_path / "authorized"
        if not authorized_path.exists():
            logger.warning(f"Cannot reset device: {authorized_path} not found")
            return False

        # Toggle authorized state
        logger.info(f"Resetting USB device at {port_path}")

        # Disable
        authorized_path.write_text("0")
        await asyncio.sleep(0.5)

        # Re-enable
        authorized_path.write_text("1")

        logger.info(f"USB device reset complete: {port_path}")
        return True

    except PermissionError:
        logger.error(f"Permission denied resetting device {port_path}. Run with sudo.")
        return False
    except Exception as e:
        logger.exception(f"Error resetting device {port_path}: {e}")
        return False


@app.get("/api/devices")
async def get_devices():
    """Get current USB device tree as JSON."""
    devices = usb_monitor.get_tree()  # type: ignore
    errors = get_recent_usb_errors(200)
    for device in devices:
        _add_errors_to_tree(device, errors)

    return JSONResponse([d.model_dump_for_frontend() for d in devices])


@app.get("/api/device/{port_path:path}")
async def get_device(port_path: str):
    """Get a specific device by port path."""
    device = usb_monitor.get_device(port_path)  # type: ignore
    if device:
        errors = get_recent_usb_errors(100)
        device.errors = get_errors_for_device(port_path, errors)
        device.has_errors = len(device.errors) > 0
        return JSONResponse(device.model_dump_for_frontend())
    raise HTTPException(status_code=404, detail="Device not found")


@app.post("/api/device/{port_path:path}/reset")
async def reset_device(port_path: str):
    """Reset a USB device."""
    success = await reset_usb_device(port_path)
    if success:
        return JSONResponse({"success": True, "message": f"Device {port_path} reset"})
    raise HTTPException(status_code=500, detail="Failed to reset device")


@app.post("/api/device/name")
async def set_device_name(request: Request):
    """Set a custom name for a device."""
    data = await request.json()
    vendor_id = data.get("vendor_id")
    product_id = data.get("product_id")
    name = data.get("name")

    if not all([vendor_id, product_id, name]):
        raise HTTPException(status_code=400, detail="Missing required fields")

    config_manager.set_device_name(vendor_id, product_id, name)  # type: ignore
    usb_monitor.config_lookup = config_manager.get_device_lookup()  # type: ignore

    return JSONResponse({"success": True})


@app.get("/api/errors")
async def get_errors():
    """Get recent USB errors."""
    errors = get_recent_usb_errors(100)
    return JSONResponse([
        {
            "timestamp": e.timestamp,
            "port_path": e.port_path,
            "message": e.message,
            "severity": e.severity,
        }
        for e in errors
    ])


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return JSONResponse({
        "status": "healthy",
        "websocket_connections": ws_manager.connection_count if ws_manager else 0,
    })


@app.post("/api/shutdown")
async def shutdown():
    """Shutdown the server."""
    logger.info("Shutdown requested via API")
    os.kill(os.getpid(), signal.SIGTERM)
    return JSONResponse({"status": "shutting_down"})


def run_server(host: str = "0.0.0.0", port: int = 8080, open_browser: bool = True):
    """Run the server."""
    import uvicorn

    if open_browser:
        # Open browser after short delay
        def open_browser_delayed():
            import time
            import webbrowser
            time.sleep(1.5)
            webbrowser.open(f"http://localhost:{port}")

        import threading
        threading.Thread(target=open_browser_delayed, daemon=True).start()

    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    # Allow running directly
    port = int(os.environ.get("USB_DEBUG_PORT", "8080"))
    host = os.environ.get("USB_DEBUG_HOST", "0.0.0.0")
    open_browser = os.environ.get("USB_DEBUG_NO_BROWSER", "").lower() not in ("1", "true", "yes")

    run_server(host=host, port=port, open_browser=open_browser)
