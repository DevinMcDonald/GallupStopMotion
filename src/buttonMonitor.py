from typing import override

import serial


class InputMonitor:
    def commands(self):
        # assert False, "Not Implemented"
        print("Called un-overwritten function")
        yield str("")

    def stop(self):
        print("Called un-overwritten function")


class SerialDeviceMonitor(InputMonitor):
    # Adjust the port name to your Arduino's (e.g. "COM3" on Windows, "/dev/ttyACM0" or "/dev/ttyUSB0" on Linux/Mac)
    BUTTON_MAP: dict[str, str] = {
        "0": "snap",
        "1": "play",
        "2": "restart",
    }

    def __init__(self, deviceName: str, baudRate: int = 9600):
        self.deviceName: str = deviceName
        self.baudRate: int = baudRate
        self.serial: serial.Serial = serial.Serial(self.deviceName, self.baudRate)
        self._stop: bool = False

    def _serialInputs(self):
        while not self._stop:
            if self.serial.in_waiting > 0:
                line = self.serial.readline().decode().strip()
                yield line

    @override
    def commands(self):
        for button in self._serialInputs():
            assert button in self.BUTTON_MAP
            if button not in self.BUTTON_MAP:
                print(f"Receieved invalid button from serial input: {button}")
                return
            yield self.BUTTON_MAP[button]

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
    DEVICE: str = "/dev/tty.usbmodem1301"
    BAUD: int = 9600
    try:
        monitor = SerialDeviceMonitor(DEVICE, BAUD)
    except Exception as _:
        print("failed to open input device. Defaulting to Keyboard input")
        monitor = CliMonitor()

    for cmd in monitor.commands():
        print(cmd)


if __name__ == "__main__":
    main()
