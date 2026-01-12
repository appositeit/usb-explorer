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
from .vendor_lookup import get_usb_id_database

logger = logging.getLogger(__name__)


def get_device_class(device: pyudev.Device) -> DeviceClass:
    """Determine device class from udev properties."""
    context = device.context

    # Check driver first for quick classification
    driver = device.get("DRIVER", "")

    if driver == "hub":
        return DeviceClass.HUB

    if driver in ("usbhid", "hid-generic"):
        # Try to distinguish keyboard vs mouse
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

    if driver in ("cdc_acm", "cdc_ether", "ch341", "cp210x", "ftdi_sio", "pl2303"):
        return DeviceClass.COMM

    # Check ID_TYPE which udev sets based on detected type
    id_type = device.get("ID_TYPE", "")
    if id_type == "video":
        return DeviceClass.VIDEO
    if id_type == "audio":
        return DeviceClass.AUDIO
    if id_type == "disk":
        return DeviceClass.STORAGE

    # Check ID_INPUT properties (set for HID devices)
    if device.get("ID_INPUT_KEYBOARD"):
        return DeviceClass.HID_KEYBOARD
    if device.get("ID_INPUT_MOUSE"):
        return DeviceClass.HID_MOUSE
    if device.get("ID_INPUT"):
        return DeviceClass.HID_OTHER

    # Check device class from USB descriptor - read from sysfs if not in udev
    bDeviceClass = device.get("bDeviceClass")
    if not bDeviceClass:
        # Try reading directly from sysfs
        try:
            class_path = Path(device.sys_path) / "bDeviceClass"
            if class_path.exists():
                bDeviceClass = class_path.read_text().strip()
        except Exception:
            pass

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

    # Look at child interfaces for classification (USB devices with class 0x00)
    # Interfaces have the actual class info
    try:
        for child in context.list_devices(
            subsystem="usb",
            DEVTYPE="usb_interface",
            parent=device
        ):
            child_driver = child.get("DRIVER", "")

            # Check driver on interfaces
            if child_driver in ("usbhid", "hid-generic", "hid"):
                # Look deeper for input type
                for input_dev in context.list_devices(subsystem="input", parent=child):
                    if input_dev.get("ID_INPUT_KEYBOARD"):
                        return DeviceClass.HID_KEYBOARD
                    if input_dev.get("ID_INPUT_MOUSE"):
                        return DeviceClass.HID_MOUSE
                return DeviceClass.HID_OTHER

            if child_driver in ("snd-usb-audio", "snd_usb_audio"):
                return DeviceClass.AUDIO

            if child_driver in ("uvcvideo", "uvc"):
                return DeviceClass.VIDEO

            if child_driver in ("usb-storage", "uas"):
                return DeviceClass.STORAGE

            if child_driver in ("usblp",):
                return DeviceClass.PRINTER

            if child_driver in ("btusb", "ath3k", "rtl8xxxu"):
                return DeviceClass.WIRELESS

            if child_driver in ("cdc_acm", "cdc_ether", "ch341", "cp210x", "ftdi_sio", "pl2303"):
                return DeviceClass.COMM

            # Check interface class
            bInterfaceClass = child.get("bInterfaceClass")
            if bInterfaceClass:
                try:
                    iface_class = int(bInterfaceClass, 16) if isinstance(bInterfaceClass, str) else int(bInterfaceClass)
                    if iface_class == 1:  # Audio
                        return DeviceClass.AUDIO
                    if iface_class == 2:  # Communications
                        return DeviceClass.COMM
                    if iface_class == 3:  # HID
                        return DeviceClass.HID_OTHER
                    if iface_class == 7:  # Printer
                        return DeviceClass.PRINTER
                    if iface_class == 8:  # Mass Storage
                        return DeviceClass.STORAGE
                    if iface_class == 14:  # Video
                        return DeviceClass.VIDEO
                    if iface_class == 224:  # Wireless
                        return DeviceClass.WIRELESS
                except (ValueError, TypeError):
                    pass
    except Exception as e:
        logger.debug(f"Error checking child interfaces: {e}")

    return DeviceClass.UNKNOWN


def parse_speed(speed_str: str) -> str:
    """Convert speed value to human-readable format."""
    if not speed_str:
        return ""
    try:
        speed = int(speed_str)
        if speed >= 5000:
            return f"{speed // 1000}G"
        return f"{speed}M"
    except ValueError:
        # Return empty string for unparseable values instead of raw string
        return ""


def find_device_nodes(device: pyudev.Device) -> list[str]:
    """Find /dev/ nodes associated with a USB device (e.g., /dev/ttyACM0, /dev/sda)."""
    dev_nodes = []
    context = device.context

    try:
        # Look for tty devices (serial ports like ttyACM0, ttyUSB0)
        for tty_dev in context.list_devices(subsystem="tty", parent=device):
            if tty_dev.device_node:
                dev_nodes.append(tty_dev.device_node)

        # Look for block devices (storage like sda, sdb)
        for block_dev in context.list_devices(subsystem="block", parent=device):
            if block_dev.device_node:
                dev_nodes.append(block_dev.device_node)

        # Look for sound devices
        for snd_dev in context.list_devices(subsystem="sound", parent=device):
            if snd_dev.device_node:
                dev_nodes.append(snd_dev.device_node)

        # Look for video devices (webcams)
        for video_dev in context.list_devices(subsystem="video4linux", parent=device):
            if video_dev.device_node:
                dev_nodes.append(video_dev.device_node)

        # Look for input devices
        for input_dev in context.list_devices(subsystem="input", parent=device):
            if input_dev.device_node:
                dev_nodes.append(input_dev.device_node)

        # Look for hidraw devices
        for hid_dev in context.list_devices(subsystem="hidraw", parent=device):
            if hid_dev.device_node:
                dev_nodes.append(hid_dev.device_node)

    except Exception as e:
        logger.debug(f"Error finding device nodes: {e}")

    # Sort and deduplicate
    return sorted(set(dev_nodes))


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

        # Look up vendor and product names from usb.ids database
        usb_db = get_usb_id_database()
        vendor_name = usb_db.get_vendor(vendor_id)
        product_name = usb_db.get_product(vendor_id, product_id)

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

        # Calculate parent path from port path
        # e.g., "5-1.2.4" -> parent is "5-1.2"
        # e.g., "5-1" -> parent is "usb5"
        parent_path = None
        if not is_root_hub and port_path:
            if "." in port_path:
                parent_path = port_path.rsplit(".", 1)[0]
            elif "-" in port_path:
                bus = port_path.split("-")[0]
                parent_path = f"usb{bus}"

        # Find associated device nodes (e.g., /dev/ttyACM0)
        dev_nodes = find_device_nodes(device)

        usb_device = USBDevice(
            bus=int(busnum),
            device=int(devnum),
            port_path=port_path,
            vendor_id=vendor_id,
            product_id=product_id,
            vendor_name=vendor_name,
            product_name=product_name,
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
            parent_path=parent_path,
            dev_nodes=dev_nodes,
            children=[],
            errors=[],
        )

        return usb_device

    except Exception as e:
        logger.exception(f"Error building USB device from {device.sys_path}: {e}")
        return None


class USBMonitor:
    """Monitors USB devices and maintains device tree."""

    # Time window for grouping disconnections (100ms)
    LEARNING_WINDOW_MS = 100

    def __init__(self, config_lookup: Optional[dict] = None, config_manager=None):
        self.context = pyudev.Context()
        self.monitor: Optional[pyudev.Monitor] = None
        self._running = False
        self._devices: dict[str, USBDevice] = {}  # port_path -> device
        self._callbacks: list[Callable[[USBEvent], None]] = []
        self.config_lookup = config_lookup or {}
        self.config_manager = config_manager  # For accessing saved physical groups
        # Learning mode state
        self._learning_mode = False
        self._learning_disconnects: list[tuple[float, str, USBDevice]] = []  # (timestamp, port_path, device)
        self._learning_exclude_storage = False

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
                import time
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

                    # Track disconnect if in learning mode
                    if self._learning_mode:
                        disconnect_time = time.time()
                        self._learning_disconnects.append((disconnect_time, port_path, removed_device))
                        logger.debug(f"Learning mode: tracked disconnect of {removed_device.display_name}")

                        # Emit learning detected event after a short delay to group disconnects
                        # This is handled by the frontend checking learning_data

                    event = USBEvent(
                        type=EventType.DEVICE_REMOVED,
                        port_path=port_path,
                        device=removed_device,
                        learning_data={"in_learning_mode": self._learning_mode} if self._learning_mode else None
                    )
                    self._emit_event(event)
                    logger.info(f"Device removed: {removed_device.display_name} from {port_path}")

    def stop_monitoring(self) -> None:
        """Stop monitoring USB events."""
        self._running = False
        logger.info("USB monitoring stopped")

    # Learning mode methods

    def has_storage_devices(self, port_path: Optional[str] = None) -> list[USBDevice]:
        """Check if there are storage devices connected.

        If port_path is provided, only check devices under that path.
        Returns list of storage devices found.
        """
        storage_devices = []

        def check_device(device: USBDevice) -> None:
            if device.device_class == DeviceClass.STORAGE:
                storage_devices.append(device)
            for child in device.children:
                check_device(child)

        for device in self._devices.values():
            if port_path:
                # Only check if this device is under the specified path
                if device.port_path.startswith(port_path) or port_path.startswith(device.port_path):
                    check_device(device)
            else:
                check_device(device)

        return storage_devices

    def get_hubs_with_storage(self) -> list[dict]:
        """Get list of hubs that have storage devices attached."""
        hubs_with_storage = []

        def find_parent_hub(device: USBDevice) -> Optional[USBDevice]:
            """Find the hub that this device is connected to."""
            if device.parent_path:
                parent = self._devices.get(device.parent_path)
                if parent and parent.device_class == DeviceClass.HUB:
                    return parent
                elif parent:
                    return find_parent_hub(parent)
            return None

        for device in self._devices.values():
            if device.device_class == DeviceClass.STORAGE:
                hub = find_parent_hub(device)
                if hub:
                    hubs_with_storage.append({
                        "hub_path": hub.port_path,
                        "hub_name": hub.display_name,
                        "storage_device": device.display_name,
                        "storage_path": device.port_path,
                    })

        return hubs_with_storage

    def start_learning_mode(self, exclude_storage: bool = False) -> dict:
        """Start learning mode to detect physical device groups.

        Args:
            exclude_storage: If True, will warn about storage but still proceed

        Returns:
            dict with status and any warnings
        """
        import time

        storage_devices = self.has_storage_devices()
        hubs_with_storage = self.get_hubs_with_storage()

        self._learning_mode = True
        self._learning_disconnects = []
        self._learning_exclude_storage = exclude_storage

        logger.info(f"Learning mode started (exclude_storage={exclude_storage})")

        event = USBEvent(
            type=EventType.LEARNING_STARTED,
            learning_data={
                "exclude_storage": exclude_storage,
                "storage_devices": [d.display_name for d in storage_devices],
                "hubs_with_storage": hubs_with_storage,
            }
        )
        self._emit_event(event)

        return {
            "status": "started",
            "storage_warning": len(storage_devices) > 0,
            "storage_devices": [{"name": d.display_name, "path": d.port_path} for d in storage_devices],
            "hubs_with_storage": hubs_with_storage,
        }

    def stop_learning_mode(self, save: bool = False) -> dict:
        """Stop learning mode.

        Args:
            save: If True, returns the detected group for saving

        Returns:
            dict with detected group info if save=True
        """
        import time

        if not self._learning_mode:
            return {"status": "not_in_learning_mode"}

        self._learning_mode = False

        # Group disconnects by time window
        detected_group = self._analyze_disconnects()

        if save and detected_group:
            event = USBEvent(
                type=EventType.LEARNING_SAVED,
                learning_data={"group": detected_group}
            )
        else:
            event = USBEvent(
                type=EventType.LEARNING_CANCELLED,
                learning_data={"detected": detected_group}
            )

        self._emit_event(event)
        self._learning_disconnects = []

        logger.info(f"Learning mode stopped (save={save}, detected={detected_group})")

        return {
            "status": "saved" if save else "cancelled",
            "detected_group": detected_group,
        }

    def _get_existing_group_members(self) -> set[str]:
        """Get all port paths that are already in saved physical groups."""
        existing_members = set()
        if self.config_manager:
            try:
                groups = self.config_manager.get_physical_groups()
                for group in groups:
                    for member in group.members:
                        existing_members.add(member)
            except Exception as e:
                logger.warning(f"Error getting existing physical groups: {e}")
        return existing_members

    def _analyze_disconnects(self) -> Optional[dict]:
        """Analyze disconnection events to find devices that disconnected together."""
        if not self._learning_disconnects:
            return None

        # Get hubs already in saved groups - we'll exclude these
        existing_group_members = self._get_existing_group_members()
        if existing_group_members:
            logger.info(f"Excluding {len(existing_group_members)} hubs already in saved groups: {existing_group_members}")

        # Sort by timestamp
        self._learning_disconnects.sort(key=lambda x: x[0])

        # Group events within the time window
        groups: list[list[tuple[float, str, USBDevice]]] = []
        current_group: list[tuple[float, str, USBDevice]] = []

        for disconnect in self._learning_disconnects:
            timestamp, port_path, device = disconnect

            if not current_group:
                current_group = [disconnect]
            elif (timestamp - current_group[0][0]) * 1000 <= self.LEARNING_WINDOW_MS:
                # Within time window of first event in group
                current_group.append(disconnect)
            else:
                # New group
                if current_group:
                    groups.append(current_group)
                current_group = [disconnect]

        if current_group:
            groups.append(current_group)

        # Find the largest group (most likely to be a physical device disconnect)
        if not groups:
            return None

        largest_group = max(groups, key=len)

        if len(largest_group) < 1:
            return None

        # Build the result - only include HUB devices that aren't already in saved groups
        members = []
        devices_info = []
        has_storage = False
        skipped_existing = []

        for timestamp, port_path, device in largest_group:
            # Only include hub devices in the physical group
            if device.device_class == DeviceClass.HUB:
                # Skip hubs that are already in a saved physical group
                if port_path in existing_group_members:
                    skipped_existing.append(port_path)
                    logger.info(f"Skipping {port_path} - already in a saved physical group")
                    continue
                members.append(port_path)
                devices_info.append({
                    "port_path": port_path,
                    "name": device.display_name,
                    "device_class": device.device_class.value,
                })
            if device.device_class == DeviceClass.STORAGE:
                has_storage = True

        if skipped_existing:
            logger.info(f"Skipped {len(skipped_existing)} hubs already in groups: {skipped_existing}")

        # Must have at least one hub to form a valid group
        if not members:
            return None

        return {
            "members": members,
            "devices": devices_info,
            "has_storage": has_storage,
            "timestamp": largest_group[0][0],
            "skipped_existing": skipped_existing,
        }

    def is_learning_mode(self) -> bool:
        """Check if currently in learning mode."""
        return self._learning_mode

    def get_testable_hubs(self) -> list[dict]:
        """Get list of hubs that can be tested (non-root hubs).

        Returns:
            List of hub info dicts with port_path, name, has_storage
        """
        hubs = []

        def collect_hubs(device: USBDevice, parent_is_root: bool = False):
            # Skip root hubs - we can't disable those
            if device.is_root_hub:
                for child in device.children:
                    collect_hubs(child, parent_is_root=True)
                return

            if device.device_class == DeviceClass.HUB:
                # Check if this hub has storage devices under it
                has_storage = self._hub_has_storage(device)
                hubs.append({
                    "port_path": device.port_path,
                    "name": device.display_name,
                    "vendor_id": device.vendor_id,
                    "product_id": device.product_id,
                    "has_storage": has_storage,
                })

            for child in device.children:
                collect_hubs(child)

        for device in self._devices.values():
            if device.parent_path is None or device.is_root_hub:
                collect_hubs(device)

        return hubs

    def _hub_has_storage(self, hub: USBDevice) -> bool:
        """Check if a hub has any storage devices connected under it."""
        def check_children(device: USBDevice) -> bool:
            if device.device_class == DeviceClass.STORAGE:
                return True
            for child in device.children:
                if check_children(child):
                    return True
            return False

        for child in hub.children:
            if check_children(child):
                return True
        return False

    def _get_all_hub_descendants(self, hub_path: str) -> list[str]:
        """Get all hub port paths that are descendants of the given hub."""
        hub = self._devices.get(hub_path)
        if not hub:
            return []

        descendants = []

        def collect(device: USBDevice):
            if device.device_class == DeviceClass.HUB and device.port_path != hub_path:
                descendants.append(device.port_path)
            for child in device.children:
                collect(child)

        for child in hub.children:
            collect(child)

        return descendants

    async def test_hub(self, port_path: str) -> dict:
        """Test a hub by disabling and re-enabling it.

        Uses depth-first testing to identify only hubs that are truly part of
        the same physical device (bidirectional dependency), not just downstream
        hubs that happen to be connected.

        Algorithm:
        1. Disable target hub, record which hubs disappear (candidates)
        2. Re-enable target hub
        3. For each candidate, test if disabling IT also makes target disappear
           - If yes: same physical device (bidirectional)
           - If no: separate device, just connected downstream

        Args:
            port_path: The port path of the hub to test

        Returns:
            dict with detected hub group info
        """
        import asyncio
        from pathlib import Path

        # Verify the hub exists
        hub = self._devices.get(port_path)
        if not hub:
            return {"status": "error", "message": "Hub not found"}
        if hub.device_class != DeviceClass.HUB:
            return {"status": "error", "message": "Not a hub device"}

        # Get the sysfs path
        sysfs_path = Path(f"/sys/bus/usb/devices/{port_path}")
        authorized_path = sysfs_path / "authorized"

        if not authorized_path.exists():
            return {"status": "error", "message": "Cannot access hub (sysfs path not found)"}

        # Record current state - get all hubs before disabling
        hubs_before = set(
            p for p, d in self._devices.items()
            if d.device_class == DeviceClass.HUB and not d.is_root_hub
        )

        logger.info(f"Testing hub {port_path} - phase 1: finding candidates...")

        candidate_hubs = set()

        try:
            # Phase 1: Disable target hub and find all hubs that disappear
            authorized_path.write_text("0")
            await asyncio.sleep(0.4)

            hubs_after = set(
                p for p, d in self._devices.items()
                if d.device_class == DeviceClass.HUB and not d.is_root_hub
            )

            candidate_hubs = hubs_before - hubs_after
            logger.info(f"Phase 1: {len(candidate_hubs)} candidate hubs disappeared")

            # Re-enable target hub
            authorized_path.write_text("1")
            await asyncio.sleep(0.8)  # Wait for full reconnection

        except PermissionError:
            return {"status": "error", "message": "Permission denied. Run with sudo."}
        except Exception as e:
            logger.exception(f"Error in phase 1: {e}")
            # Try to re-enable
            try:
                authorized_path.write_text("1")
            except:
                pass
            return {"status": "error", "message": str(e)}

        # Phase 2: Test each candidate to see if it's truly part of same physical device
        # A hub is part of the same physical device if disabling IT also makes
        # our target hub disappear (bidirectional dependency)
        same_device_hubs = {port_path}  # Target is always included

        for candidate in candidate_hubs:
            candidate_sysfs = Path(f"/sys/bus/usb/devices/{candidate}")
            candidate_auth = candidate_sysfs / "authorized"

            if not candidate_auth.exists():
                continue

            logger.info(f"Phase 2: Testing candidate {candidate}...")

            try:
                # Disable the candidate
                candidate_auth.write_text("0")
                await asyncio.sleep(0.3)

                # Check if target hub is still present
                target_still_exists = port_path in self._devices

                if not target_still_exists:
                    # Disabling this candidate also killed the target
                    # They're part of the same physical device!
                    same_device_hubs.add(candidate)
                    logger.info(f"  {candidate} is SAME physical device (bidirectional)")
                else:
                    logger.info(f"  {candidate} is SEPARATE device (downstream only)")

                # Re-enable the candidate
                candidate_auth.write_text("1")
                await asyncio.sleep(0.5)

            except Exception as e:
                logger.warning(f"Error testing candidate {candidate}: {e}")
                # Try to re-enable
                try:
                    candidate_auth.write_text("1")
                except:
                    pass

        logger.info(f"Detection complete: {len(same_device_hubs)} hubs in physical group")

        # Build the result
        members = list(same_device_hubs)
        devices_info = []

        # Wait a bit more for devices to fully reconnect
        await asyncio.sleep(0.3)

        # Get device info
        for member_path in members:
            device = self._devices.get(member_path)
            if device:
                devices_info.append({
                    "port_path": member_path,
                    "name": device.display_name,
                    "device_class": device.device_class.value,
                })
            else:
                # Device hasn't reconnected yet, use path as name
                devices_info.append({
                    "port_path": member_path,
                    "name": member_path,
                    "device_class": "hub",
                })

        if not members:
            return {"status": "error", "message": "No hubs detected in group"}

        return {
            "status": "success",
            "detected_group": {
                "members": members,
                "devices": devices_info,
                "tested_hub": port_path,
            }
        }
