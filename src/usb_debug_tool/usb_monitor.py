"""
USB device monitoring using pyudev.

Provides real-time monitoring of USB device connections/disconnections
and builds a hierarchical tree representation of the USB topology.
"""

from __future__ import annotations
import asyncio
import logging
from pathlib import Path
from typing import Callable, Optional
import pyudev

from .models import USBDevice, DeviceClass, USBEvent, EventType

logger = logging.getLogger(__name__)


def get_device_class(device: pyudev.Device) -> DeviceClass:
    """Determine device class from udev properties."""
    # Check driver first for quick classification
    driver = device.get("DRIVER", "")

    if driver == "hub":
        return DeviceClass.HUB

    if driver in ("usbhid", "hid-generic"):
        # Try to distinguish keyboard vs mouse
        id_input = device.get("ID_INPUT", "")
        if device.get("ID_INPUT_KEYBOARD"):
            return DeviceClass.HID_KEYBOARD
        if device.get("ID_INPUT_MOUSE"):
            return DeviceClass.HID_MOUSE
        return DeviceClass.HID_OTHER

    if driver in ("snd-usb-audio", "snd_usb_audio"):
        return DeviceClass.AUDIO

    if driver in ("uvcvideo", "uvc"):
        return DeviceClass.VIDEO

    if driver in ("usb-storage", "uas"):
        return DeviceClass.STORAGE

    if driver in ("usblp",):
        return DeviceClass.PRINTER

    if driver in ("btusb", "ath3k", "rtl8xxxu"):
        return DeviceClass.WIRELESS

    if driver in ("cdc_acm", "cdc_ether", "ch341", "cp210x", "ftdi_sio"):
        return DeviceClass.COMM

    # Check device class from USB descriptor
    bDeviceClass = device.get("bDeviceClass")
    if bDeviceClass:
        try:
            class_code = int(bDeviceClass, 16) if isinstance(bDeviceClass, str) else int(bDeviceClass)
            if class_code == 9:  # Hub
                return DeviceClass.HUB
            if class_code == 1:  # Audio
                return DeviceClass.AUDIO
            if class_code == 2:  # Communications
                return DeviceClass.COMM
            if class_code == 3:  # HID
                return DeviceClass.HID_OTHER
            if class_code == 7:  # Printer
                return DeviceClass.PRINTER
            if class_code == 8:  # Mass Storage
                return DeviceClass.STORAGE
            if class_code == 14:  # Video
                return DeviceClass.VIDEO
            if class_code == 224:  # Wireless
                return DeviceClass.WIRELESS
        except (ValueError, TypeError):
            pass

    return DeviceClass.UNKNOWN


def parse_speed(speed_str: str) -> str:
    """Convert speed value to human-readable format."""
    if not speed_str:
        return "Unknown"
    try:
        speed = int(speed_str)
        if speed >= 5000:
            return f"{speed // 1000}G"
        return f"{speed}M"
    except ValueError:
        return speed_str


def build_usb_device(device: pyudev.Device, config_lookup: Optional[dict] = None) -> Optional[USBDevice]:
    """Build a USBDevice from a pyudev Device."""
    try:
        # Get basic properties
        busnum = device.get("BUSNUM")
        devnum = device.get("DEVNUM")

        if not busnum or not devnum:
            return None

        # Build port path from device path
        # Device path looks like: /sys/devices/pci0000:00/.../usb5/5-1/5-1.2
        devpath = device.sys_path
        port_path = ""

        # busnum has leading zeros (e.g., "001") but paths use bare numbers ("1-1")
        bus_bare = str(int(busnum))

        # Extract port path from sys_path
        parts = devpath.split("/")
        for part in reversed(parts):
            # Match patterns like "1-1", "5-1.2.4", or "usb1"
            if part.startswith(bus_bare + "-"):
                port_path = part
                break
            if part == f"usb{bus_bare}":
                port_path = part
                break

        if not port_path:
            # Root hub fallback
            port_path = f"usb{bus_bare}"

        vendor_id = device.get("ID_VENDOR_ID", "0000")
        product_id = device.get("ID_MODEL_ID", "0000")

        # Check for custom name in config
        custom_name = None
        if config_lookup:
            key = f"{vendor_id}:{product_id}"
            custom_name = config_lookup.get(key)

        # Get number of ports for hubs
        num_ports = None
        maxchild_path = Path(device.sys_path) / "maxchild"
        if maxchild_path.exists():
            try:
                num_ports = int(maxchild_path.read_text().strip())
                if num_ports == 0:
                    num_ports = None
            except (ValueError, IOError):
                pass

        # Get power draw
        power_draw = 0
        # Try bMaxPower (USB 2.0 style)
        max_power = device.get("bMaxPower", "")
        if max_power:
            try:
                # Format: "500mA" or just number
                power_draw = int(max_power.replace("mA", "").strip())
            except ValueError:
                pass

        # Determine if root hub
        is_root_hub = device.get("DEVTYPE") == "usb_device" and devpath.endswith(f"/usb{bus_bare}")

        usb_device = USBDevice(
            bus=int(busnum),
            device=int(devnum),
            port_path=port_path,
            vendor_id=vendor_id,
            product_id=product_id,
            manufacturer=device.get("ID_VENDOR") or device.get("ID_VENDOR_FROM_DATABASE"),
            product=device.get("ID_MODEL") or device.get("ID_MODEL_FROM_DATABASE"),
            serial=device.get("ID_SERIAL_SHORT"),
            speed=parse_speed(device.get("SPEED", "")),
            usb_version=device.get("bcdUSB", ""),
            device_class=get_device_class(device),
            device_class_raw=int(device.get("bDeviceClass", "0") or "0", 16) if device.get("bDeviceClass") else 0,
            num_ports=num_ports,
            power_draw_ma=power_draw,
            custom_name=custom_name,
            is_root_hub=is_root_hub,
            driver=device.get("DRIVER"),
            children=[],
            errors=[],
        )

        return usb_device

    except Exception as e:
        logger.exception(f"Error building USB device from {device.sys_path}: {e}")
        return None


class USBMonitor:
    """Monitors USB devices and maintains device tree."""

    def __init__(self, config_lookup: Optional[dict] = None):
        self.context = pyudev.Context()
        self.monitor: Optional[pyudev.Monitor] = None
        self._running = False
        self._devices: dict[str, USBDevice] = {}  # port_path -> device
        self._callbacks: list[Callable[[USBEvent], None]] = []
        self.config_lookup = config_lookup or {}

    def register_callback(self, callback: Callable[[USBEvent], None]) -> None:
        """Register a callback for USB events."""
        self._callbacks.append(callback)

    def unregister_callback(self, callback: Callable[[USBEvent], None]) -> None:
        """Unregister a callback."""
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    def _emit_event(self, event: USBEvent) -> None:
        """Emit event to all registered callbacks."""
        import time
        event.timestamp = time.time()
        for callback in self._callbacks:
            try:
                callback(event)
            except Exception as e:
                logger.exception(f"Error in USB event callback: {e}")

    def scan_devices(self) -> list[USBDevice]:
        """Scan and return all current USB devices as a tree."""
        self._devices.clear()
        devices_flat: list[USBDevice] = []

        # Get all USB devices
        for device in self.context.list_devices(subsystem="usb", DEVTYPE="usb_device"):
            usb_dev = build_usb_device(device, self.config_lookup)
            if usb_dev:
                self._devices[usb_dev.port_path] = usb_dev
                devices_flat.append(usb_dev)

        # Build tree structure
        root_devices = self._build_tree(devices_flat)

        return root_devices

    def _build_tree(self, devices: list[USBDevice]) -> list[USBDevice]:
        """Build hierarchical tree from flat device list."""
        # Sort by port path length to process parents before children
        devices.sort(key=lambda d: len(d.port_path))

        roots: list[USBDevice] = []
        path_map: dict[str, USBDevice] = {d.port_path: d for d in devices}

        for device in devices:
            if device.is_root_hub or device.port_path.startswith("usb"):
                roots.append(device)
                continue

            # Find parent by trimming port path
            # e.g., "5-1.2.4" -> parent is "5-1.2"
            port_path = device.port_path
            if "." in port_path:
                parent_path = port_path.rsplit(".", 1)[0]
            elif "-" in port_path:
                # Direct child of root hub, e.g., "5-1" -> parent is "usb5"
                bus = port_path.split("-")[0]
                parent_path = f"usb{bus}"
            else:
                roots.append(device)
                continue

            parent = path_map.get(parent_path)
            if parent:
                device.parent_path = parent_path
                parent.children.append(device)
            else:
                # No parent found, treat as root
                roots.append(device)

        return roots

    def get_device(self, port_path: str) -> Optional[USBDevice]:
        """Get device by port path."""
        return self._devices.get(port_path)

    def get_tree(self) -> list[USBDevice]:
        """Get current device tree."""
        return self.scan_devices()

    async def start_monitoring(self) -> None:
        """Start monitoring USB events asynchronously."""
        if self._running:
            return

        self.monitor = pyudev.Monitor.from_netlink(self.context)
        self.monitor.filter_by(subsystem="usb", device_type="usb_device")
        self._running = True

        logger.info("USB monitoring started")

        # Run in thread to avoid blocking
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._monitor_loop)

    def _monitor_loop(self) -> None:
        """Blocking monitor loop (runs in thread)."""
        if not self.monitor:
            return

        for device in iter(self.monitor.poll, None):
            if not self._running:
                break

            action = device.action

            if action == "add":
                usb_dev = build_usb_device(device, self.config_lookup)
                if usb_dev:
                    self._devices[usb_dev.port_path] = usb_dev
                    event = USBEvent(type=EventType.DEVICE_ADDED, device=usb_dev)
                    self._emit_event(event)
                    logger.info(f"Device added: {usb_dev.display_name} at {usb_dev.port_path}")

            elif action == "remove":
                # Try to find device by sys_path
                port_path = None
                devpath = device.sys_path
                parts = devpath.split("/")
                for part in reversed(parts):
                    if "-" in part and not part.startswith("pci"):
                        port_path = part
                        break

                if port_path and port_path in self._devices:
                    removed_device = self._devices.pop(port_path)
                    event = USBEvent(
                        type=EventType.DEVICE_REMOVED,
                        port_path=port_path,
                        device=removed_device
                    )
                    self._emit_event(event)
                    logger.info(f"Device removed: {removed_device.display_name} from {port_path}")

    def stop_monitoring(self) -> None:
        """Stop monitoring USB events."""
        self._running = False
        logger.info("USB monitoring stopped")
