from re import M

import cv2

from buttonMonitor import CliMonitor, InputMonitor, SerialDeviceMonitor
from capture import ImageCapturer
from display import Display
from imageStorage import ImageStorage


def openInputMonitor() -> InputMonitor:
    DEVICE: str = "/dev/tty.usbmodem1301"
    BAUD: int = 9600
    try:
        monitor: InputMonitor = SerialDeviceMonitor(DEVICE, BAUD)
    except Exception as _:
        print("failed to open input device. Defaulting to Keyboard input")
        monitor: InputMonitor = CliMonitor()
    return monitor


def main():
    monitor: InputMonitor = openInputMonitor()
    storage: ImageStorage = ImageStorage()
    capture: ImageCapturer = ImageCapturer()
    display = Display()
    display.open()

    for cmd in monitor.commands():
        if cmd == "snap":
            _ = capture.capture()
        elif cmd == "reset":
            storage.clear()
        elif cmd == "play":
            images: list[cv2.typing.MatLike] = storage.retrieveAll()
            display.showSlideShow(images)

        print(cmd)
    display.showSlideShow(storage.retrieveAll())


if __name__ == "__main__":
    main()
