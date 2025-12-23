"""
Pydantic models for USB devices and events.

Defines the data structures used throughout the application for representing
USB devices, their hierarchy, and real-time events.
"""

from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum


class DeviceClass(str, Enum):
    """USB device class categories for icon and colour mapping."""
    HUB = "hub"
    HID_KEYBOARD = "hid_keyboard"
    HID_MOUSE = "hid_mouse"
    HID_OTHER = "hid_other"
    AUDIO = "audio"
    VIDEO = "video"
    STORAGE = "storage"
    PRINTER = "printer"
    WIRELESS = "wireless"
    COMM = "comm"
    UNKNOWN = "unknown"


class USBDevice(BaseModel):
    """Represents a USB device in the tree."""

    # Identification
    bus: int = Field(description="USB bus number")
    device: int = Field(description="Device number on the bus")
    port_path: str = Field(description="Port path e.g. '5-1.2.4'")

    # USB IDs
    vendor_id: str = Field(description="Vendor ID in hex e.g. '05e3'")
    product_id: str = Field(description="Product ID in hex e.g. '0610'")

    # Vendor/Product names from usb.ids database
    vendor_name: Optional[str] = Field(default=None, description="Vendor name from usb.ids")
    product_name: Optional[str] = Field(default=None, description="Product name from usb.ids")

    # Descriptors
    manufacturer: Optional[str] = Field(default=None, description="Manufacturer string")
    product: Optional[str] = Field(default=None, description="Product string")
    serial: Optional[str] = Field(default=None, description="Serial number")

    # Technical details
    speed: str = Field(description="Connection speed e.g. '480M', '5000M'")
    usb_version: str = Field(default="", description="USB version e.g. '2.0', '3.1'")
    device_class: DeviceClass = Field(default=DeviceClass.UNKNOWN)
    device_class_raw: int = Field(default=0, description="Raw USB device class code")

    # Hub specific
    num_ports: Optional[int] = Field(default=None, description="Number of ports if hub")

    # Power
    power_draw_ma: int = Field(default=0, description="Power draw in milliamps")

    # User customisation
    custom_name: Optional[str] = Field(default=None, description="User-defined name")

    # Errors
    errors: list[str] = Field(default_factory=list, description="Error messages from dmesg")
    has_errors: bool = Field(default=False, description="Quick check for error state")

    # Hierarchy
    children: list[USBDevice] = Field(default_factory=list, description="Child devices")
    parent_path: Optional[str] = Field(default=None, description="Parent device path")

    # State
    is_root_hub: bool = Field(default=False, description="True if this is a root hub")
    driver: Optional[str] = Field(default=None, description="Kernel driver name")

    @property
    def display_name(self) -> str:
        """Get the best available name for display."""
        if self.custom_name:
            return self.custom_name
        if self.product:
            return self.product
        if self.product_name:
            return self.product_name

        # Build name from vendor and device type
        vendor = self.vendor_name or self.manufacturer
        device_type = self._friendly_device_type()

        if vendor and device_type:
            return f"{vendor} ({device_type})"
        if vendor:
            return vendor
        if device_type:
            return f"Unknown ({device_type})"

        # Last resort: use IDs
        return f"{self.vendor_id}:{self.product_id}"

    def _friendly_device_type(self) -> Optional[str]:
        """Get friendly name for device type."""
        type_names = {
            DeviceClass.HUB: "Hub",
            DeviceClass.HID_KEYBOARD: "Keyboard",
            DeviceClass.HID_MOUSE: "Mouse",
            DeviceClass.HID_OTHER: "Input Device",
            DeviceClass.AUDIO: "Audio",
            DeviceClass.VIDEO: "Webcam",
            DeviceClass.STORAGE: "Storage",
            DeviceClass.PRINTER: "Printer",
            DeviceClass.WIRELESS: "Wireless",
            DeviceClass.COMM: "Serial",
            DeviceClass.UNKNOWN: None,
        }
        return type_names.get(self.device_class)

    @property
    def unique_id(self) -> str:
        """Unique identifier for this device instance."""
        return f"{self.bus}-{self.port_path}"

    def model_dump_for_frontend(self) -> dict:
        """Serialize for frontend consumption with computed properties."""
        data = self.model_dump()
        data["display_name"] = self.display_name
        data["unique_id"] = self.unique_id

        # Recursively serialize children
        if self.children:
            data["children"] = [child.model_dump_for_frontend() for child in self.children]

        return data


class EventType(str, Enum):
    """Types of USB events."""
    FULL_TREE = "full_tree"
    DEVICE_ADDED = "device_added"
    DEVICE_REMOVED = "device_removed"
    DEVICE_ERROR = "device_error"
    DEVICE_UPDATED = "device_updated"


class USBEvent(BaseModel):
    """Represents a USB event to be sent to the frontend."""

    type: EventType
    device: Optional[USBDevice] = None
    devices: Optional[list[USBDevice]] = None  # For full_tree
    port_path: Optional[str] = None  # For removals (device no longer exists)
    error_message: Optional[str] = None
    timestamp: float = Field(default=0.0)

    def to_websocket_message(self) -> dict:
        """Convert to WebSocket message format."""
        msg = {"type": self.type.value, "timestamp": self.timestamp}

        if self.type == EventType.FULL_TREE:
            msg["data"] = [d.model_dump_for_frontend() for d in (self.devices or [])]
        elif self.type == EventType.DEVICE_REMOVED:
            msg["port_path"] = self.port_path
            # Include device data so frontend can show info about removed device
            if self.device:
                msg["data"] = self.device.model_dump_for_frontend()
        elif self.type == EventType.DEVICE_ERROR:
            msg["port_path"] = self.port_path
            if self.device:
                msg["data"] = self.device.model_dump_for_frontend()
        elif self.device:
            msg["data"] = self.device.model_dump_for_frontend()

        if self.error_message:
            msg["error"] = self.error_message

        return msg


class DeviceConfig(BaseModel):
    """User configuration for a device (custom name, etc)."""

    vendor_id: str
    product_id: str
    custom_name: Optional[str] = None
    notes: Optional[str] = None


class AppConfig(BaseModel):
    """Application configuration."""

    port: int = Field(default=8080)
    host: str = Field(default="0.0.0.0")
    auto_open_browser: bool = Field(default=True)
    devices: list[DeviceConfig] = Field(default_factory=list)
