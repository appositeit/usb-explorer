"""
Parse dmesg output for USB-related errors.

Monitors kernel messages for USB errors and associates them with devices.
"""

from __future__ import annotations
import asyncio
import logging
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Optional

logger = logging.getLogger(__name__)


@dataclass
class USBError:
    """Represents a USB error from dmesg."""
    timestamp: float
    port_path: str
    message: str
    raw_line: str
    severity: str = "error"  # error, warning, info


# Patterns to match USB errors in dmesg
USB_ERROR_PATTERNS = [
    # Device errors
    (r"usb (\d+-[\d.]+): device descriptor read.*, error (-?\d+)", "Device descriptor read failed"),
    (r"usb (\d+-[\d.]+): device not accepting address .*, error (-?\d+)", "Device not accepting address"),
    (r"usb (\d+-[\d.]+): USB disconnect, device number (\d+)", "Device disconnected"),
    (r"usb (\d+-[\d.]+): can't .*, error (-?\d+)", "Device error"),

    # Hub errors
    (r"usb (usb\d+-port\d+): disabled by hub \(EMI\?\)", "Port disabled (possible EMI)"),
    (r"usb (usb\d+-port\d+): cannot reset", "Port cannot reset"),
    (r"usb (usb\d+-port\d+): unable to enumerate USB device", "Cannot enumerate device"),
    (r"usb (usb\d+-port\d+): attempt power cycle", "Power cycle attempted"),
    (r"usb (usb\d+-port\d+): connect-debounce failed", "Connect debounce failed"),

    # Hub port errors with different format
    (r"usb (\d+-[\d.]+)-port(\d+): disabled by hub", "Port disabled by hub"),
    (r"usb (\d+-[\d.]+)-port(\d+): cannot", "Port error"),

    # Over-current
    (r"usb (\d+-[\d.]+): over-current", "Over-current detected"),

    # Reset errors
    (r"usb (\d+-[\d.]+): reset.*failed", "Reset failed"),
]

# Compiled patterns
COMPILED_PATTERNS = [(re.compile(p), desc) for p, desc in USB_ERROR_PATTERNS]


def parse_dmesg_line(line: str) -> Optional[USBError]:
    """Parse a single dmesg line for USB errors."""
    # Skip non-USB lines quickly
    if "usb" not in line.lower():
        return None

    # Try each pattern
    for pattern, description in COMPILED_PATTERNS:
        match = pattern.search(line)
        if match:
            port_path = match.group(1)

            # Normalise port path
            # Convert "usb5-port1" -> "5-1" style if needed
            if port_path.startswith("usb") and "-port" in port_path:
                parts = port_path.replace("usb", "").split("-port")
                if len(parts) == 2:
                    port_path = f"{parts[0]}-{parts[1]}"

            # Determine severity
            severity = "error"
            if "disconnect" in line.lower():
                severity = "info"
            elif "warning" in line.lower():
                severity = "warning"

            return USBError(
                timestamp=datetime.now().timestamp(),
                port_path=port_path,
                message=description,
                raw_line=line.strip(),
                severity=severity,
            )

    return None


def get_recent_usb_errors(lines: int = 100) -> list[USBError]:
    """Get recent USB errors from dmesg."""
    errors: list[USBError] = []

    try:
        result = subprocess.run(
            ["dmesg", "--time-format=iso"],
            capture_output=True,
            text=True,
            timeout=5,
        )

        if result.returncode != 0:
            # Try without sudo (may have limited access)
            result = subprocess.run(
                ["dmesg"],
                capture_output=True,
                text=True,
                timeout=5,
            )

        if result.stdout:
            # Process last N lines
            all_lines = result.stdout.strip().split("\n")
            for line in all_lines[-lines:]:
                error = parse_dmesg_line(line)
                if error:
                    errors.append(error)

    except subprocess.TimeoutExpired:
        logger.warning("dmesg command timed out")
    except subprocess.SubprocessError as e:
        logger.exception(f"Error running dmesg: {e}")

    return errors


def get_errors_for_device(port_path: str, errors: Optional[list[USBError]] = None) -> list[str]:
    """Get error messages for a specific device."""
    if errors is None:
        errors = get_recent_usb_errors()

    device_errors = []
    for error in errors:
        # Match exact path or parent path
        if error.port_path == port_path or port_path.startswith(error.port_path + "."):
            device_errors.append(f"[{error.severity.upper()}] {error.message}")

    return device_errors


class DmesgMonitor:
    """Monitor dmesg for new USB errors in real-time."""

    def __init__(self):
        self._running = False
        self._callbacks: list[Callable[[USBError], None]] = []
        self._last_errors: list[USBError] = []

    def register_callback(self, callback: Callable[[USBError], None]) -> None:
        """Register callback for new errors."""
        self._callbacks.append(callback)

    def unregister_callback(self, callback: Callable[[USBError], None]) -> None:
        """Unregister callback."""
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    def _emit_error(self, error: USBError) -> None:
        """Emit error to callbacks."""
        for callback in self._callbacks:
            try:
                callback(error)
            except Exception as e:
                logger.exception(f"Error in dmesg callback: {e}")

    async def start_monitoring(self) -> None:
        """Start monitoring dmesg for new errors."""
        if self._running:
            return

        self._running = True
        logger.info("dmesg monitoring started")

        # Get initial errors to avoid duplicates
        self._last_errors = get_recent_usb_errors(200)
        seen_lines = {e.raw_line for e in self._last_errors}

        while self._running:
            try:
                # Poll for new errors every 2 seconds
                await asyncio.sleep(2)

                new_errors = get_recent_usb_errors(50)
                for error in new_errors:
                    if error.raw_line not in seen_lines:
                        seen_lines.add(error.raw_line)
                        self._last_errors.append(error)
                        self._emit_error(error)

                # Limit stored errors
                if len(self._last_errors) > 500:
                    self._last_errors = self._last_errors[-200:]
                    seen_lines = {e.raw_line for e in self._last_errors}

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception(f"Error in dmesg monitor: {e}")
                await asyncio.sleep(5)

        logger.info("dmesg monitoring stopped")

    def stop_monitoring(self) -> None:
        """Stop monitoring."""
        self._running = False

    def get_cached_errors(self) -> list[USBError]:
        """Get cached errors."""
        return self._last_errors.copy()
