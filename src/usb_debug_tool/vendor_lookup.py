"""
USB Vendor and Product ID lookup from usb.ids database.

Parses /usr/share/hwdata/usb.ids to map vendor/product IDs to names.
"""

from __future__ import annotations
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Common locations for usb.ids file
USB_IDS_PATHS = [
    "/usr/share/hwdata/usb.ids",
    "/usr/share/misc/usb.ids",
    "/usr/share/usb.ids",
    "/var/lib/usbutils/usb.ids",
]


class USBIDDatabase:
    """Lookup vendor and product names from USB ID database."""

    def __init__(self):
        self._vendors: dict[str, str] = {}  # vendor_id -> vendor_name
        self._products: dict[str, dict[str, str]] = {}  # vendor_id -> {product_id -> product_name}
        self._loaded = False

    def load(self, path: Optional[str] = None) -> bool:
        """Load the USB ID database.

        Args:
            path: Optional explicit path to usb.ids file

        Returns:
            True if loaded successfully
        """
        if self._loaded:
            return True

        # Find the usb.ids file
        usb_ids_path = None
        if path:
            usb_ids_path = Path(path)
            if not usb_ids_path.exists():
                logger.warning(f"Specified usb.ids path not found: {path}")
                usb_ids_path = None

        if not usb_ids_path:
            for candidate in USB_IDS_PATHS:
                p = Path(candidate)
                if p.exists():
                    usb_ids_path = p
                    break

        if not usb_ids_path:
            logger.warning("USB ID database not found")
            return False

        try:
            self._parse_usb_ids(usb_ids_path)
            self._loaded = True
            logger.info(f"Loaded {len(self._vendors)} vendors from {usb_ids_path}")
            return True
        except Exception as e:
            logger.exception(f"Failed to parse USB ID database: {e}")
            return False

    def _parse_usb_ids(self, path: Path) -> None:
        """Parse the usb.ids file format.

        Format:
        # Comment lines start with #
        XXXX  Vendor Name
        <tab>YYYY  Product Name
        <tab>ZZZZ  Another Product
        """
        current_vendor = None

        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                # Skip empty lines and comments
                if not line.strip() or line.startswith("#"):
                    continue

                # Check for vendor line (no leading whitespace, starts with hex)
                if not line[0].isspace():
                    parts = line.strip().split(None, 1)
                    if len(parts) >= 2 and len(parts[0]) == 4:
                        try:
                            # Verify it's a valid hex vendor ID
                            int(parts[0], 16)
                            vendor_id = parts[0].lower()
                            vendor_name = parts[1]
                            self._vendors[vendor_id] = vendor_name
                            self._products[vendor_id] = {}
                            current_vendor = vendor_id
                        except ValueError:
                            # Not a vendor line (might be a class definition)
                            current_vendor = None
                    else:
                        current_vendor = None

                # Check for product line (starts with tab, under current vendor)
                elif line.startswith("\t") and not line.startswith("\t\t"):
                    if current_vendor:
                        parts = line.strip().split(None, 1)
                        if len(parts) >= 2 and len(parts[0]) == 4:
                            try:
                                int(parts[0], 16)
                                product_id = parts[0].lower()
                                product_name = parts[1]
                                self._products[current_vendor][product_id] = product_name
                            except ValueError:
                                pass

    def get_vendor(self, vendor_id: str) -> Optional[str]:
        """Get vendor name by ID.

        Args:
            vendor_id: 4-character hex vendor ID (e.g., "05e3")

        Returns:
            Vendor name or None if not found
        """
        if not self._loaded:
            self.load()
        return self._vendors.get(vendor_id.lower())

    def get_product(self, vendor_id: str, product_id: str) -> Optional[str]:
        """Get product name by vendor and product ID.

        Args:
            vendor_id: 4-character hex vendor ID
            product_id: 4-character hex product ID

        Returns:
            Product name or None if not found
        """
        if not self._loaded:
            self.load()
        vendor_products = self._products.get(vendor_id.lower())
        if vendor_products:
            return vendor_products.get(product_id.lower())
        return None

    def lookup(self, vendor_id: str, product_id: str) -> tuple[Optional[str], Optional[str]]:
        """Look up both vendor and product names.

        Args:
            vendor_id: 4-character hex vendor ID
            product_id: 4-character hex product ID

        Returns:
            Tuple of (vendor_name, product_name), either may be None
        """
        return (self.get_vendor(vendor_id), self.get_product(vendor_id, product_id))


# Global instance for shared use
_db_instance: Optional[USBIDDatabase] = None


def get_usb_id_database() -> USBIDDatabase:
    """Get the global USB ID database instance."""
    global _db_instance
    if _db_instance is None:
        _db_instance = USBIDDatabase()
        _db_instance.load()
    return _db_instance


def lookup_vendor(vendor_id: str) -> Optional[str]:
    """Convenience function to look up vendor name."""
    return get_usb_id_database().get_vendor(vendor_id)


def lookup_product(vendor_id: str, product_id: str) -> Optional[str]:
    """Convenience function to look up product name."""
    return get_usb_id_database().get_product(vendor_id, product_id)
