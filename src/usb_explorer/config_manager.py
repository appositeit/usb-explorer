"""
Configuration management for USB Explorer.

Handles loading and saving of user configuration including custom device names.
"""

from __future__ import annotations
import logging
from pathlib import Path
from typing import Optional
import yaml

from .models import AppConfig, DeviceConfig, PhysicalGroup

logger = logging.getLogger(__name__)

# Use absolute path based on project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_CONFIG_PATH = _PROJECT_ROOT / "config" / "devices.yaml"


class ConfigManager:
    """Manages application configuration."""

    def __init__(self, config_path: Optional[Path] = None):
        self.config_path = config_path or DEFAULT_CONFIG_PATH
        self._config: Optional[AppConfig] = None
        self._device_lookup: dict[str, str] = {}  # "vendor:product" -> custom_name

    @property
    def config(self) -> AppConfig:
        """Get current configuration, loading if necessary."""
        if self._config is None:
            self.load()
        return self._config  # type: ignore

    def load(self) -> AppConfig:
        """Load configuration from file."""
        if self.config_path.exists():
            try:
                with open(self.config_path) as f:
                    data = yaml.safe_load(f) or {}

                # Parse devices list
                devices = []
                for dev_data in data.get("devices", []):
                    devices.append(DeviceConfig(**dev_data))

                # Parse hub labels
                hub_labels = data.get("hub_labels", {}) or {}

                # Parse physical groups
                physical_groups = []
                for group_data in data.get("physical_groups", []):
                    physical_groups.append(PhysicalGroup(**group_data))

                self._config = AppConfig(
                    port=data.get("port", 8080),
                    host=data.get("host", "0.0.0.0"),
                    auto_open_browser=data.get("auto_open_browser", True),
                    devices=devices,
                    hub_labels=hub_labels,
                    physical_groups=physical_groups,
                )

                # Build lookup table
                self._device_lookup = {
                    f"{d.vendor_id}:{d.product_id}": d.custom_name
                    for d in devices
                    if d.custom_name
                }

                logger.info(f"Loaded configuration from {self.config_path}")

            except Exception as e:
                logger.exception(f"Error loading config from {self.config_path}: {e}")
                self._config = AppConfig()
        else:
            logger.info(f"No config file found at {self.config_path}, using defaults")
            self._config = AppConfig()

        return self._config

    def save(self) -> None:
        """Save current configuration to file."""
        if self._config is None:
            return

        # Ensure directory exists
        self.config_path.parent.mkdir(parents=True, exist_ok=True)

        data = {
            "port": self._config.port,
            "host": self._config.host,
            "auto_open_browser": self._config.auto_open_browser,
            "devices": [
                {
                    "vendor_id": d.vendor_id,
                    "product_id": d.product_id,
                    "custom_name": d.custom_name,
                    "notes": d.notes,
                }
                for d in self._config.devices
            ],
            "hub_labels": self._config.hub_labels,
            "physical_groups": [
                {
                    "name": g.name,
                    "label": g.label,
                    "members": g.members,
                }
                for g in self._config.physical_groups
            ],
        }

        try:
            with open(self.config_path, "w") as f:
                yaml.dump(data, f, default_flow_style=False, sort_keys=False)
            logger.info(f"Saved configuration to {self.config_path}")
        except Exception as e:
            logger.exception(f"Error saving config to {self.config_path}: {e}")

    def get_device_name(self, vendor_id: str, product_id: str) -> Optional[str]:
        """Get custom name for a device if configured."""
        key = f"{vendor_id}:{product_id}"
        return self._device_lookup.get(key)

    def get_device_lookup(self) -> dict[str, str]:
        """Get the full vendor:product -> name lookup table."""
        if self._config is None:
            self.load()
        return self._device_lookup.copy()

    def get_hub_labels(self) -> dict[str, str]:
        """Get the hub labels configuration."""
        if self._config is None:
            self.load()
        return self._config.hub_labels.copy()  # type: ignore

    def set_hub_label(self, key: str, label: Optional[str]) -> None:
        """Set or remove a hub label."""
        if self._config is None:
            self.load()

        if label:
            self._config.hub_labels[key] = label  # type: ignore
        else:
            self._config.hub_labels.pop(key, None)  # type: ignore

        self.save()

    def set_device_name(self, vendor_id: str, product_id: str, name: str) -> None:
        """Set custom name for a device."""
        if self._config is None:
            self.load()

        key = f"{vendor_id}:{product_id}"

        # Update or add device config
        for device in self._config.devices:  # type: ignore
            if device.vendor_id == vendor_id and device.product_id == product_id:
                device.custom_name = name
                break
        else:
            self._config.devices.append(  # type: ignore
                DeviceConfig(vendor_id=vendor_id, product_id=product_id, custom_name=name)
            )

        self._device_lookup[key] = name
        self.save()

    def remove_device_name(self, vendor_id: str, product_id: str) -> None:
        """Remove custom name for a device."""
        if self._config is None:
            self.load()

        key = f"{vendor_id}:{product_id}"
        self._device_lookup.pop(key, None)

        self._config.devices = [  # type: ignore
            d for d in self._config.devices  # type: ignore
            if not (d.vendor_id == vendor_id and d.product_id == product_id)
        ]
        self.save()

    def get_physical_groups(self) -> list[PhysicalGroup]:
        """Get all physical device groups."""
        if self._config is None:
            self.load()
        return self._config.physical_groups.copy()  # type: ignore

    def add_physical_group(self, name: str, members: list[str], label: Optional[str] = None) -> PhysicalGroup:
        """Add a new physical device group."""
        if self._config is None:
            self.load()

        # Check for existing group with overlapping members
        for group in self._config.physical_groups:  # type: ignore
            overlap = set(group.members) & set(members)
            if overlap:
                # Remove overlapping members from existing group
                group.members = [m for m in group.members if m not in overlap]
                # If group is now empty, remove it
                if not group.members:
                    self._config.physical_groups.remove(group)  # type: ignore

        new_group = PhysicalGroup(name=name, members=members, label=label)
        self._config.physical_groups.append(new_group)  # type: ignore
        self.save()
        return new_group

    def update_physical_group(self, old_name: str, name: str, label: Optional[str] = None) -> Optional[PhysicalGroup]:
        """Update an existing physical group's name or label."""
        if self._config is None:
            self.load()

        for group in self._config.physical_groups:  # type: ignore
            if group.name == old_name:
                group.name = name
                group.label = label
                self.save()
                return group
        return None

    def remove_physical_group(self, name: str) -> bool:
        """Remove a physical group by name."""
        if self._config is None:
            self.load()

        for group in self._config.physical_groups:  # type: ignore
            if group.name == name:
                self._config.physical_groups.remove(group)  # type: ignore
                self.save()
                return True
        return False

    def find_physical_group_for_device(self, port_path: str) -> Optional[PhysicalGroup]:
        """Find the physical group that contains a device."""
        if self._config is None:
            self.load()

        for group in self._config.physical_groups:  # type: ignore
            if port_path in group.members:
                return group
        return None


# Global config manager instance
_config_manager: Optional[ConfigManager] = None


def get_config_manager(config_path: Optional[Path] = None) -> ConfigManager:
    """Get or create the global config manager."""
    global _config_manager
    if _config_manager is None:
        _config_manager = ConfigManager(config_path)
    return _config_manager
