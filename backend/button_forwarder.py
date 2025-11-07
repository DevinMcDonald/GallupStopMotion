#!/usr/bin/env python3
import os
import sys

import requests
from buttonMonitor import BAUD, DEVICE, SerialDeviceMonitor  # your serial reader

BACKEND = os.getenv("BACKEND", "http://localhost:8000")
TOKEN = os.getenv("TOKEN", "super-secret-token")  # keep in sync with backend

# Map whatever your device emits to backend event types (adjust the keys as needed)
EVENT_MAP = {
    "capture": "capture",
    "play": "play",
    "reset": "reset",
    # examples of common variants
    "CAPTURE": "capture",
    "PLAY": "play",
    "RESET": "reset",
    "BTN_A": "capture",
    "BTN_B": "play",
    "BTN_C": "reset",
}


def send(evt_raw: str) -> None:
    etype = EVENT_MAP.get(evt_raw, evt_raw).lower()
    if etype not in {"capture", "play", "reset"}:
        print(f"[forwarder] ignoring unknown event: {evt_raw!r} -> {etype!r}")
        return
    try:
        r = requests.post(
            f"{BACKEND}/api/button",
            json={"type": etype},
            headers={"Authorization": f"Bearer {TOKEN}"},
            timeout=2,
        )
        if r.status_code // 100 != 2:
            print(f"[forwarder] backend rejected {etype}: {r.status_code} {r.text}")
        else:
            print(f"[forwarder] sent {etype}: {r.status_code}")
    except Exception as e:
        print("[forwarder] send failed:", e, file=sys.stderr)


def main() -> None:
    monitor = SerialDeviceMonitor(DEVICE, BAUD)
    for (
        evt
    ) in (
        monitor.commands()
    ):  # assumes this yields strings like 'CAPTURE', 'BTN_A', etc.
        print("[forwarder] read event:", evt)
        send(evt)


if __name__ == "__main__":
    main()
