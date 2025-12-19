#!/usr/bin/env python3
import os
import sys
import threading
import time

import requests
from buttonMonitor import (
    BAUD,
    DEVICE,
    CliMonitor,
    SerialDeviceMonitor,
)  # your serial reader

BUTTON_MIN_INTERVAL = float(os.getenv("BUTTON_MIN_INTERVAL", "1.0"))
last_sent: float | None = None

BACKEND = os.getenv("BACKEND", "http://localhost:8000")
TOKEN = os.getenv("TOKEN", "super-secret-token")  # keep in sync with backend
HEARTBEAT_INTERVAL = float(os.getenv("HEARTBEAT_INTERVAL", "5"))

# Map whatever your device emits to backend event types (adjust the keys as needed)
EVENT_MAP = {
    "capture": "capture",
    "play": "play",
    "reset": "reset",
    "undo": "undo",
    "snap": "capture",
    "done": "done",
    # examples of common variants
    "CAPTURE": "capture",
    "PLAY": "play",
    "RESET": "reset",
    "UNDO": "undo",
    "SNAP": "capture",
    "DONE": "done",
    "BTN_A": "capture",
    "BTN_B": "play",
    "BTN_C": "reset",
}


def send(evt_raw: str) -> None:
    global last_sent

    now = time.time()
    if last_sent is not None and (now - last_sent) < BUTTON_MIN_INTERVAL:
        print(
            f"[forwarder] rate-limited ({BUTTON_MIN_INTERVAL}s) skipping {evt_raw}",
            file=sys.stderr,
        )
        return

    etype = EVENT_MAP.get(evt_raw, evt_raw).lower()
    if etype not in {"capture", "play", "reset", "undo", "done"}:
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
            last_sent = now
    except Exception as e:
        print("[forwarder] send failed:", e, file=sys.stderr)


def send_heartbeat(connected: bool, device: str | None, mode: str) -> None:
    try:
        requests.post(
            f"{BACKEND}/api/forwarder/heartbeat",
            json={"connected": connected, "device": device, "mode": mode},
            headers={"Authorization": f"Bearer {TOKEN}"},
            timeout=2,
        )
    except Exception as e:
        print("[forwarder] heartbeat failed:", e, file=sys.stderr)


def heartbeat_loop(
    stop_evt: threading.Event, connected: bool, device: str | None, mode: str
) -> None:
    while not stop_evt.wait(HEARTBEAT_INTERVAL):
        send_heartbeat(connected, device, mode)


def main() -> None:
    monitor = None
    stop_evt = threading.Event()
    hb_thread: threading.Thread | None = None
    try:
        monitor = SerialDeviceMonitor(DEVICE, BAUD)
        send_heartbeat(True, DEVICE, "serial")
        hb_thread = threading.Thread(
            target=heartbeat_loop,
            args=(stop_evt, True, DEVICE, "serial"),
            daemon=True,
        )
        hb_thread.start()
    except Exception as exc:
        print(
            "[forwarder] serial unavailable, falling back to keyboard (or skipping):",
            exc,
            file=sys.stderr,
        )
        if sys.stdin.isatty():
            monitor = CliMonitor()
            send_heartbeat(False, None, "cli")
            hb_thread = threading.Thread(
                target=heartbeat_loop,
                args=(stop_evt, False, None, "cli"),
                daemon=True,
            )
            hb_thread.start()
        else:
            send_heartbeat(False, None, "none")
            print("[forwarder] no TTY available; skipping button forwarding.")
            return

    try:
        for evt in monitor.commands():  # e.g., CAPTURE/BTN_A/etc.
            print("[forwarder] read event:", evt)
            send(evt)
    except Exception as exc:
        print("[forwarder] read loop failed:", exc, file=sys.stderr)
    finally:
        stop_evt.set()
        if hb_thread:
            hb_thread.join(timeout=2)


if __name__ == "__main__":
    main()
