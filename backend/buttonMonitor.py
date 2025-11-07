from typing import override
from zipfile import BadZipfile

import serial

DEVICE: str = "/dev/tty.usbmodem1201"
BAUD: int = 115200


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
        "r": "restart",
    }
    BUTTONS: set[str] = {"play", "capture", "reset", "undo", "save"}

    # Adjust the port name to your Arduino's (e.g. "COM3" on Windows, "/dev/ttyACM0" or "/dev/ttyUSB0" on Linux/Mac)
    def __init__(self, deviceName: str, baudRate: int = 115200):
        print(f"Starting {deviceName} at baud {baudRate}...")
        self.deviceName: str = deviceName
        self.baudRate: int = baudRate
        self.serial: serial.Serial = serial.Serial(self.deviceName, self.baudRate)
        self._stop: bool = False

        print(f"Successfully started {deviceName} at baud {baudRate}")

    def _serialInputs(self):
        while not self._stop:
            if self.serial.in_waiting > 0:
                line = self.serial.readline().decode().strip()
                yield line

    @override
    def commands(self):
        for button in self._serialInputs():
            assert button in self.BUTTONS, f"{button} not in buttons"
            if button not in self.BUTTONS:
                print(f"Receieved invalid button from serial input: {button}")
                return
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
