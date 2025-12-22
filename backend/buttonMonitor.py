import os
import sys
from glob import glob
from typing import override

import serial

BAUD: int = 115200


def guess_serial_device() -> str | None:
    """
    Best-effort device discovery for USB CDC serial adapters.

    - macOS: prefers /dev/tty.usbmodem* (typical Arduino), falls back to usbserial/cu variants.
    - Linux: checks /dev/ttyACM* then /dev/ttyUSB*.
    Returns the first match (sorted) or None if nothing found.
    """
    platform = sys.platform
    patterns: list[str] = []

    if platform.startswith("darwin"):
        patterns = [
            "/dev/tty.usbmodem*",
            "/dev/tty.usbserial*",
            "/dev/cu.usbmodem*",
            "/dev/cu.usbserial*",
        ]
    else:  # assume Linux/other POSIX
        patterns = [
            "/dev/ttyACM*",
            "/dev/ttyUSB*",
        ]

    for pat in patterns:
        matches = sorted(glob(pat))
        if matches:
            return matches[0]
    return None


def resolve_device() -> str | None:
    """
    Resolve the serial device path via env override or autodetect.
    Returns None when nothing is found so callers can fallback gracefully.
    """
    env_device = os.getenv("INPUT_DEVICE")
    if env_device:
        return env_device

    detected = guess_serial_device()
    if detected:
        return detected
    return None


DEVICE: str | None = resolve_device()


class InputMonitor:
    def commands(self):
        print("Called un-overwritten function")
        yield str("")

    def stop(self):
        print("Called un-overwritten function")


class SerialDeviceMonitor(InputMonitor):
    BUTTON_MAP: dict[str, str] = {
        "c": "snap",
        "p": "play",
        "u": "undo",
        "d": "done",
    }
    BUTTONS: set[str] = {"snap", "play", "undo", "done", "capture", "reset", "save"}

    # Adjust the port name to your Arduino's (e.g. "COM3" on Windows, "/dev/ttyACM0" or "/dev/ttyUSB0" on Linux/Mac)
    def __init__(self, deviceName: str | None = None, baudRate: int = 115200):
        self.deviceName: str | None = deviceName or resolve_device()
        self.baudRate: int = baudRate
        if not self.deviceName:
            raise RuntimeError(
                "No serial device found (usbmodem/usbserial/ttyACM/ttyUSB). "
                "Set INPUT_DEVICE to override."
            )

        print(f"Starting {self.deviceName} at baud {baudRate}...")
        self.serial: serial.Serial = serial.Serial(self.deviceName, self.baudRate)
        self._stop: bool = False

        print(f"Successfully started {self.deviceName} at baud {baudRate}")

    def _serialInputs(self):
        while not self._stop:
            if self.serial.in_waiting > 0:
                line = self.serial.readline().decode().strip()
                yield line

    @override
    def commands(self):
        for button in self._serialInputs():
            if not button or button not in self.BUTTONS:
                print(f"Receieved invalid button from serial input: {button}")
                continue
            yield button

    @override
    def stop(self):
        self._stop = True


class CliMonitor(InputMonitor):
    def __init__(self):
        self._stop: bool = False

    @override
    def commands(self):
        print("Input buttons 0-2 to execute functions. Input q to stop")
        s = ""
        while True:
            s = input()
            if s == "q":
                print("Goodbye")
                return

            if SerialDeviceMonitor.BUTTON_MAP.get(s) is None:
                print(f"Button {s} not found")
                return

            cmd = SerialDeviceMonitor.BUTTON_MAP[s]
            yield cmd

    @override
    def stop(self):
        self._stop = True


def main():
    try:
        monitor = SerialDeviceMonitor(DEVICE, BAUD)
    except Exception as _:
        print("failed to open input device. Defaulting to Keyboard input")
        monitor = CliMonitor()

    for cmd in monitor.commands():
        print(cmd)


if __name__ == "__main__":
    main()
