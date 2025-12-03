
  # Gallup Stop Motion Kiosk

  A fast, kiosk-friendly stop-motion capture app with multi-camera support, R2 video sharing, hardware button input, and session isolation.
  Built with FastAPI, React/Vite, and Docker.

  ## Features

  - ⚡️ Responsive stop-motion capture with live preview
  - 🎥 Camera switching (dev panel) for multi-input setups
  - 🎛️ Hardware button support (serial forwarder with rate limiting)
  - ⏱️ Inactivity guard: warns, then resets session without upload
  - 📦 R2 upload + downloadable QR codes (24h expiring link)
  - 🧹 Session isolation, frame limits, undo/reset, double-confirm “Done”
  - 🧪 Tests for backend (pytest) and frontend (vitest)

  ## Quick Start (Dev)

  Prereqs: Docker, Node 20+, Python 3.10+, `python3 -m venv`, npm.

  ```bash
  # install frontend deps once
  cd frontend && npm install && cd ..

  # run everything (frontend dev mode, button forwarder)
  make dev
  ```

  App: http://localhost:5173
  Backend: http://localhost:8000
  Button forwarder: uses `MAC_SERIAL_DEVICE` (default `/dev/tty.usbmodem1201`); falls back to keyboard if absent.

  ## Production-ish Run

  ```bash
  make prod
  ```

  - Builds/runs the frontend in prod mode (`FRONTEND_MODE=prod`, `NODE_ENV=production`).
  - Dev panels hidden, forwarder started locally.

  ## Environment

  Frontend (Vite) uses `VITE_` vars (e.g., `VITE_IDLE_WARN_MS`, `VITE_IDLE_TIMEOUT_MS`, `VITE_API_BASE`).
  Backend uses envs for R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, etc.

  Optional local overrides: `frontend/.env.local` (already set to short idle timings for testing).

  ## Tests

  ```bash
  make test
  # backend: pytest (uses venv, installs requirements)
  # frontend: vitest (node)
  ```

  ## Hardware Buttons

  - Serial forwarder: `backend/button_forwarder.py` auto-detects tty or uses `INPUT_DEVICE`; rate-limits to 1 event/sec.
  - Buttons map to capture/play/reset; double-confirm for “Done”.

  ## Camera Switching (Dev Only)

  - Dev panel shows available cameras; press 1–9 to switch.
  - If Continuity Camera (iPhone) doesn’t show video, disable Low Power Mode/unlock phone and ensure camera permissions.

  ## Video Sharing

  - “Done” uploads the session video to R2 and shows a QR code for a downloadable link (24h).
  - Auto-upload on unload is disabled; only “Done” triggers upload.

  ## Inactivity

  - Warns after `VITE_IDLE_WARN_MS` (default 10s in `.env.local`), resets after `VITE_IDLE_TIMEOUT_MS` (default 15s) only if frames exist.
  Resets without uploading.

  ## Frame Limits

  - Backend cap `MAX_FRAMES` (default 240) returns 429 when exceeded.
  - Frontend warns at 90% of the cap and blocks at the limit.

  ## Demo Video

  To embed your demo on GitHub, add a link or a thumbnail image that links to the video. Example:

  ```markdown
  ## Demo

  [![Demo video thumbnail](demo-thumbnail.png)](https://your.video.url "Watch the demo")

  ```

  - Upload `demo-thumbnail.png` to the repo (or use an external image URL).
  - Replace `https://your.video.url` with your video link (YouTube, Vimeo, etc.).

  ## Scripts & Targets

  - `make dev` — start dev stack (frontend dev, backend, button forwarder, open browser)
  - `make prod` — start prod stack (frontend prod build/preview, backend, button forwarder, open browser)
  - `make test` — run backend + frontend tests
  - `make stop` — stop containers

  ## Notes

  - Frontend prod build is triggered by `FRONTEND_MODE=prod` (set in make).
  - Compose profiles for MCU/serial are defined in `docker-compose.yml` and will run cross-platform; adjust device mapping if needed.

  ## License

  [MIT] or your preferred license.
