#!/usr/bin/env bash
set -euo pipefail

FQBN="${FQBN:-arduino:avr:uno}"
SKETCH="${SKETCH:-/workspace/Sketch/Sketch.ino}"
PORT_ENV="${PORT:-}"

# Detect a likely serial device if PORT not provided
detect_port() {
  for p in /dev/ttyACM* /dev/ttyUSB* /dev/tty.usbmodem*; do
    if [ -e "$p" ]; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

main() {
  local port="${PORT_ENV}"
  if [ -z "$port" ]; then
    if port=$(detect_port); then
      echo "[mcu] Detected serial device: $port"
    else
      echo "[mcu] No Arduino detected; skipping compile/upload (exiting success)."
      exit 0
    fi
  else
    echo "[mcu] Using specified PORT: $port"
  fi

  # Prepare toolchain (idempotent; can be skipped with env)
  if [ "${SKIP_CORE:-0}" != "1" ]; then
    arduino-cli core update-index
    arduino-cli core install "$(echo "$FQBN" | cut -d: -f1-2)" || true
  fi

  if [ "${SKIP_LIBS:-0}" != "1" ]; then
    # Example: install libraries your sketch needs
    # arduino-cli lib install "Bounce2"
    true
  fi

  echo "[mcu] Compiling $SKETCH for $FQBN"
  arduino-cli compile --fqbn "$FQBN" "$SKETCH"

  echo "[mcu] Uploading to $port"
  arduino-cli upload -p "$port" --fqbn "$FQBN" "$SKETCH"

  echo "[mcu] Done."
}

main "$@"
