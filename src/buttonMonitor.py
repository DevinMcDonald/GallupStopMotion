import serial


class SerialMonitor:
    # Adjust the port name to your Arduino's (e.g. "COM3" on Windows, "/dev/ttyACM0" or "/dev/ttyUSB0" on Linux/Mac)
    DEVICE: str = "/dev/tty.usbmodem1301"
    BAUD: int = 9600

    def __init__(self):
        self.serial: serial.Serial = serial.Serial(self.DEVICE, self.BAUD)

    def inputs(self):
        buttons: range = range(0, 4)
        while True:
            if self.serial.in_waiting > 0:
                line = self.serial.readline().decode().strip()
                try:
                    buttonNum = int(line)
                    if buttonNum not in buttons:
                        raise ValueError
                    yield int(line)
                except ValueError as _:
                    print("Received invalid input: ", line)
