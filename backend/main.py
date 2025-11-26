from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import uuid
import sys
from glob import glob
from pathlib import Path
from typing import Any

from fastapi import (
    Body,
    FastAPI,
    Header,
    Query,
    Response,
    WebSocket,
    WebSocketDisconnect,
    HTTPException,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# ----------------- Config -----------------
ORIGIN = "http://localhost:5173"  # Vite dev origin
PORT = 8000

BASE_DIR = Path(os.getenv("FRAMES_DIR", "/app/session_frames")).resolve()
FRAMES_ROOT = Path(os.getenv("FRAMES_DIR", BASE_DIR / "session_frames"))
VIDEOS_ROOT = Path(os.getenv("VIDEOS_DIR", BASE_DIR / "videos"))
FRAMES_ROOT.mkdir(parents=True, exist_ok=True)
VIDEOS_ROOT.mkdir(parents=True, exist_ok=True)

MANIFEST_NAME = "frames.json"  # kept inside each session's frames dir


# ---------- Playback ramp constants (easy to tweak) ----------
# Start at 1 frame per second so short clips are slow and clear for kids:
RAMP_MIN_FPS: float = 1.0  # starting speed

# Cap the speed so it remains readable; 12 fps is classic stop-motion smoothness:
RAMP_MAX_FPS: float = 8.0  # upper bound

# How quickly we approach the cap as frame count grows.
# Think of this as: after ~RAMP_HALF_LIFE_FRAMES, we're ~50% of the way from MIN to MAX.
RAMP_HALF_LIFE_FRAMES: int = 40

FFMPEG = shutil.which("ffmpeg")  # at module import

# ----------------- App --------------------
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/frames", StaticFiles(directory=str(FRAMES_ROOT)), name="frames")
app.mount("/videos", StaticFiles(directory=str(VIDEOS_ROOT)), name="videos")


@app.get("/health")
def health():
    return {"ok": True}


# ----------------- Session helpers -----------------


def session_dirs(session: str | None):
    """Return (frames_dir, videos_dir, manifest_path) for a session (or default)."""
    sname = session or "_default"
    fdir = FRAMES_ROOT / sname
    vdir = VIDEOS_ROOT / sname
    fdir.mkdir(parents=True, exist_ok=True)
    vdir.mkdir(parents=True, exist_ok=True)
    manifest = fdir / MANIFEST_NAME
    return fdir, vdir, manifest


def load_manifest(manifest_path: Path) -> list[dict[str, Any]]:
    if manifest_path.exists():
        try:
            return json.loads(manifest_path.read_text())
        except Exception:
            return []
    return []


def save_manifest(manifest_path: Path, data) -> None:
    # ensure parent directory exists
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    # write to a temp file in the same directory, then atomic replace
    with tempfile.NamedTemporaryFile(
        dir=manifest_path.parent,
        prefix=manifest_path.stem + ".",
        suffix=".tmp",
        delete=False,
        mode="w",
        encoding="utf-8",
    ) as tf:
        json.dump(data, tf)
        tf.flush()
        os.fsync(tf.fileno())
        tmp_path = Path(tf.name)

    os.replace(tmp_path, manifest_path)  # atomic on the same filesystem


def next_index(manifest: list[dict[str, Any]]) -> int:
    return (manifest[-1]["index"] + 1) if manifest else 1


def detect_serial_device() -> str | None:
    """Best-effort serial device detection for dev convenience."""
    env_device = os.getenv("INPUT_DEVICE")
    if env_device and Path(env_device).exists():
        return env_device

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


def build_video_file(session: str | None) -> tuple[str, Path]:
    """
    Build a video for the given session and return (session_prefix, output_path).
    Raises HTTPException for missing frames/ffmpeg failures to preserve the HTTP status.
    """
    import math

    frames_dir, videos_dir, manifest_path = session_dirs(session)
    videos_dir.mkdir(parents=True, exist_ok=True)

    ffmpeg_bin = globals().get("FFMPEG") or shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise HTTPException(
            status_code=503, detail="ffmpeg not available in container"
        )

    manifest = load_manifest(manifest_path)
    if not manifest:
        files = sorted(frames_dir.glob("*.jpg"), key=lambda p: p.name)
        manifest = [{"index": i + 1, "file": p.name} for i, p in enumerate(files)]
        save_manifest(manifest_path, manifest)

    if not manifest:
        raise HTTPException(status_code=400, detail="No frames to build")

    ordered_files = [
        frames_dir / item["file"]
        for item in manifest
        if (frames_dir / item["file"]).exists()
    ]
    if not ordered_files:
        raise HTTPException(status_code=400, detail="No frames to build")

    n = len(ordered_files)
    fps = RAMP_MIN_FPS + (RAMP_MAX_FPS - RAMP_MIN_FPS) * (
        1.0 - math.exp(-n / float(RAMP_HALF_LIFE_FRAMES))
    )
    frame_sec = 1.0 / max(fps, 0.001)

    for old in videos_dir.glob("*.mp4"):
        try:
            old.unlink()
        except Exception:
            pass
    vid_name = "latest.mp4"
    vid_path = videos_dir / vid_name

    listfile = videos_dir / f"list_{uuid.uuid4().hex}.txt"
    with listfile.open("w", encoding="utf-8") as f:
        for p in ordered_files:
            fpath = p.as_posix().replace("'", "'\\''")
            f.write(f"file '{fpath}'\n")
            f.write(f"duration {frame_sec:.6f}\n")
        last_path = ordered_files[-1].as_posix().replace("'", "'\\''")
        f.write(f"file '{last_path}'\n")

    proc = subprocess.run(
        [
            ffmpeg_bin,
            "-loglevel",
            "error",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(listfile),
            "-vsync",
            "vfr",
            "-pix_fmt",
            "yuv420p",
            str(vid_path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    try:
        listfile.unlink(missing_ok=True)
    except Exception:
        pass

    if proc.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"ffmpeg failed:\n{proc.stderr[:4000]}",
        )

    session_prefix = session or "_default"
    return session_prefix, vid_path


# ----------------- Core routes (ordered capture & build) -----------------

from fastapi import File, UploadFile

# Frame limit (30s @ 8fps = 240)
MAX_FRAMES = int(os.getenv("MAX_FRAMES", "240"))
# Debounce physical button events (seconds)
BUTTON_MIN_INTERVAL = float(os.getenv("BUTTON_MIN_INTERVAL", "1.0"))
@app.post("/api/frames")
async def upload_frame(
    frame: UploadFile = File(...),
    session: str | None = Query(default=None),
):
    """
    Accept a JPEG frame and record it in a session-ordered manifest.
    Filenames are zero-padded by index to guarantee lexicographic order too.
    """
    frames_dir, _, manifest_path = session_dirs(session)
    manifest = load_manifest(manifest_path)

    if len(manifest) >= MAX_FRAMES:
        return Response(
            status_code=429,
            content=f"Frame limit reached ({MAX_FRAMES}).",
        )

    idx = next_index(manifest)
    filename = f"{idx:06d}.jpg"  # ensures sort order by name too
    out = frames_dir / filename

    content = await frame.read()
    out.write_bytes(content)

    manifest.append({"index": idx, "file": filename})
    save_manifest(manifest_path, manifest)

    session_prefix = session or "_default"
    return {
        "id": idx,
        "thumbnail_url": f"/frames/{session_prefix}/{filename}",
        "count": len(manifest),
    }


@app.delete("/api/frames/last", status_code=204)
def delete_last(session: str | None = Query(default=None)):
    """Undo: remove the most recent frame by capture order (manifest) or by filename if needed."""
    frames_dir, _, manifest_path = session_dirs(session)
    manifest = load_manifest(manifest_path)

    if manifest:
        last = manifest.pop()
        (frames_dir / last["file"]).unlink(missing_ok=True)
        save_manifest(manifest_path, manifest)
        return {"count": len(manifest)}

    # Fallback: no manifest entries, look at disk
    jpgs = sorted(frames_dir.glob("*.jpg"), key=lambda p: p.name)
    if not jpgs:
        return Response(status_code=204)

    # Remove the last JPG, then rebuild a fresh manifest from remaining files
    jpgs[-1].unlink(missing_ok=True)
    remaining = sorted(frames_dir.glob("*.jpg"), key=lambda p: p.name)

    # Rebuild manifest strictly by filename order (1-based contiguous indices)
    rebuilt = []
    for i, p in enumerate(remaining, start=1):
        rebuilt.append({"index": i, "file": p.name})
    save_manifest(manifest_path, rebuilt)
    return {"count": len(rebuilt)}


@app.delete("/api/frames/all")
def delete_all(session: str | None = Query(default=None)):
    """Hard reset: remove ALL frames & videos for this session and reset manifest."""
    frames_dir, videos_dir, manifest_path = session_dirs(session)

    # remove all artifacts
    shutil.rmtree(frames_dir, ignore_errors=True)
    shutil.rmtree(videos_dir, ignore_errors=True)

    # recreate clean dirs
    frames_dir.mkdir(parents=True, exist_ok=True)
    videos_dir.mkdir(parents=True, exist_ok=True)

    # write empty manifest atomically
    save_manifest(manifest_path, [])

    return {"ok": True}


@app.post("/api/video")
def build_video(session: str | None = Query(default=None)):
    """
    Build an MP4 strictly in capture order using the session's manifest.
    Playback speed ramps from RAMP_MIN_FPS toward RAMP_MAX_FPS using an ease-out curve.

    Overwrites the previous video for this session as 'latest.mp4'.
    """
    try:
        session_prefix, vid_path = build_video_file(session)
    except HTTPException as exc:
        return Response(status_code=exc.status_code, content=str(exc.detail))

    return {"video_url": f"/videos/{session_prefix}/{vid_path.name}"}


@app.post("/api/session/share")
def share_session_video(session: str | None = Query(default=None)):
    """
    Build the current session's video (if possible) and upload it to the R2 share bucket.
    Always returns a 200-style payload describing whether anything was shared so callers
    can safely fire-and-forget during tab closes or restarts.
    """
    print(f"[share] request for session={session or '_default'}")

    summary: dict[str, Any] = {
        "session": session or "_default",
        "shared": False,
        "share": None,
        "video_url": None,
    }

    try:
        session_prefix, vid_path = build_video_file(session)
        summary["video_url"] = f"/videos/{session_prefix}/{vid_path.name}"
        print(f"[share] built video at {vid_path}")
    except HTTPException as exc:
        summary["reason"] = str(exc.detail)
        summary["status"] = exc.status_code
        print(f"[share] build failed: {summary['reason']}")
        return summary

    try:
        from r2_share import create_share
    except Exception as exc:
        summary["reason"] = f"R2 not configured: {exc}"
        print(f"[share] config failure: {summary['reason']}")
        return summary

    try:
        fname = f"exports/{session_prefix}-{uuid.uuid4().hex}.mp4"
        summary["share"] = create_share(
            vid_path.read_bytes(),
            content_type="video/mp4",
            filename=fname,
        )
        summary["shared"] = True
        print(f"[share] uploaded {summary['share']}")
    except Exception as exc:
        summary["reason"] = f"upload failed: {exc}"
        print(f"[share] upload failed: {summary['reason']}")

    return summary


@app.get("/api/serial/status")
def serial_status():
    """
    Dev helper: report whether a serial input device was auto-detected.
    Does not open the device; only checks presence of expected paths or INPUT_DEVICE env.
    """
    dev = detect_serial_device()
    return {"connected": bool(dev), "device": dev}


# ----------------- Optional: physical button → browser via WebSocket -----------------

SHARED_TOKEN = "super-secret-token"  # set from env in production


class EventBus:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.lock = asyncio.Lock()

    async def register(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self.lock:
            self.clients.add(ws)

    async def unregister(self, ws: WebSocket) -> None:
        async with self.lock:
            self.clients.discard(ws)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        data = json.dumps(payload)
        async with self.lock:
            dead: list[WebSocket] = []
            for ws in self.clients:
                try:
                    await ws.send_text(data)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                self.clients.discard(ws)


bus = EventBus()


@app.websocket("/ws")
async def ws_events(ws: WebSocket):
    await bus.register(ws)
    try:
        while True:
            # keepalive; we don't require client->server messages
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await bus.unregister(ws)


@app.post("/api/button")
async def button_event(
    event: dict = Body(...),
    authorization: str | None = Header(default=None),
):
    # Simple bearer check so only your button daemon can post
    if authorization != f"Bearer {SHARED_TOKEN}":
        return Response(status_code=401, content="unauthorized")

    etype = event.get("type")
    if etype not in {"capture", "play", "reset"}:
        return Response(status_code=400, content="bad type")

    await bus.broadcast({"type": etype})
    return {"ok": True}
