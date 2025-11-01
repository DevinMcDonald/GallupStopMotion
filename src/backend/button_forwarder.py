#!/usr/bin/env python3
import os
import time

import requests
import serial

BACKEND = os.getenv("BACKEND", "http://localhost:8000")
TOKEN = os.getenv("TOKEN", "super-secret-token")
SERIAL_PORT = os.getenv("SERIAL_PORT", "/dev/ttyACM0")  # adjust as needed
BAUD = int(os.getenv("BAUD", "115200"))


def send(evt_type: str) -> None:
    try:
        requests.post(
            f"{BACKEND}/api/button",
            json={"type": evt_type},
            headers={"Authorization": f"Bearer {TOKEN}"},
            timeout=2,
        )
    except Exception as e:
        print("send failed:", e)


def main() -> None:
    ser = serial.Serial(SERIAL_PORT, BAUD, timeout=0.1)
    print("listening on", SERIAL_PORT)
    last_sent = {"capture": 0.0, "play": 0.0, "reset": 0.0}
    debounce = 0.25  # seconds
    while True:
        line = ser.readline().decode("utf-8", "ignore").strip()
        if not line:
            time.sleep(0.01)
            continue
        event = line.upper()
        now = time.monotonic()
        if event == "CAPTURE" and now - last_sent["capture"] > debounce:
            send("capture")
            last_sent["capture"] = now
        elif event == "PLAY" and now - last_sent["play"] > debounce:
            send("play")
            last_sent["play"] = now
        elif event == "RESET" and now - last_sent["reset"] > debounce:
            send("reset")
            last_sent["reset"] = now
        else:
            print("unknown:", line)


if __name__ == "__main__":
    main()
