from __future__ import annotations

import asyncio
import json
import subprocess
import uuid
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
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# ----------------- Config -----------------
ORIGIN = "http://localhost:5173"  # Vite dev origin
PORT = 8000

BASE_DIR = Path(__file__).resolve().parent
FRAMES_ROOT = BASE_DIR / "session_frames"  # frames/<session>/
VIDEOS_ROOT = BASE_DIR / "videos"  # videos/<session>/
FRAMES_ROOT.mkdir(exist_ok=True)
VIDEOS_ROOT.mkdir(exist_ok=True)

MANIFEST_NAME = "frames.json"  # kept inside each session's frames dir


# ---------- Playback ramp constants (easy to tweak) ----------
# Start at 1 frame per second so short clips are slow and clear for kids:
RAMP_MIN_FPS: float = 1.0  # starting speed

# Cap the speed so it remains readable; 12 fps is classic stop-motion smoothness:
RAMP_MAX_FPS: float = 8.0  # upper bound

# How quickly we approach the cap as frame count grows.
# Think of this as: after ~RAMP_HALF_LIFE_FRAMES, we're ~50% of the way from MIN to MAX.
RAMP_HALF_LIFE_FRAMES: int = 40

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


@app.get("/api/health")
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


def save_manifest(manifest_path: Path, items: list[dict[str, Any]]) -> None:
    tmp = manifest_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, indent=2))
    tmp.replace(manifest_path)


def next_index(manifest: list[dict[str, Any]]) -> int:
    return (manifest[-1]["index"] + 1) if manifest else 1


# ----------------- Core routes (ordered capture & build) -----------------

from fastapi import File, UploadFile


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

    idx = next_index(manifest)
    filename = f"{idx:06d}.jpg"  # ensures sort order by name too
    out = frames_dir / filename

    content = await frame.read()
    out.write_bytes(content)

    manifest.append({"index": idx, "file": filename})
    save_manifest(manifest_path, manifest)

    session_prefix = session or "_default"
    return {"id": idx, "thumbnail_url": f"/frames/{session_prefix}/{filename}"}


@app.delete("/api/frames/last", status_code=204)
def delete_last(session: str | None = Query(default=None)):
    """Remove the most recent frame (by capture order) for this session."""
    frames_dir, _, manifest_path = session_dirs(session)
    manifest = load_manifest(manifest_path)

    if not manifest:
        return Response(status_code=204)

    last = manifest.pop()
    try:
        (frames_dir / last["file"]).unlink(missing_ok=True)
    finally:
        save_manifest(manifest_path, manifest)


@app.delete("/api/frames/all")
def delete_all(session: str | None = Query(default=None)):
    """Delete all frames for this session."""
    frames_dir, _, manifest_path = session_dirs(session)
    deleted = 0
    for p in frames_dir.glob("*"):
        if p.name == MANIFEST_NAME:
            continue
        try:
            p.unlink(missing_ok=True)
            deleted += 1
        except:
            pass
    save_manifest(manifest_path, [])
    return {"deleted": deleted}


@app.post("/api/video")
def build_video(session: str | None = Query(default=None)):
    """
    Build an MP4 strictly in capture order using the session's manifest.
    Playback speed ramps automatically from a kid-friendly slow start (RAMP_MIN_FPS)
    toward a smooth cap (RAMP_MAX_FPS) using an ease-out curve based on frame count.

    We still repeat the final frame once (without 'duration') so ffmpeg preserves it.
    """
    import math

    frames_dir, videos_dir, manifest_path = session_dirs(session)
    manifest = load_manifest(manifest_path)

    # Fallback in case an old session has no manifest yet
    if not manifest:
        files = sorted([p for p in frames_dir.glob("*.jpg")], key=lambda p: p.name)
        manifest = [{"index": i + 1, "file": p.name} for i, p in enumerate(files)]
        save_manifest(manifest_path, manifest)

    if not manifest:
        return Response(status_code=400, content="No frames to build")

    ordered_files = [
        frames_dir / item["file"]
        for item in manifest
        if (frames_dir / item["file"]).exists()
    ]
    if not ordered_files:
        return Response(status_code=400, content="No frames to build")

    n = len(ordered_files)

    # ----- Compute FPS using a gentle ease-out curve -----
    # Ease-out exponential toward RAMP_MAX_FPS:
    #   fps(n) = MIN + (MAX - MIN) * (1 - exp(-n / HLF))
    # Tweak MIN, MAX, HLF at the top of the file to change behavior.
    fps = RAMP_MIN_FPS + (RAMP_MAX_FPS - RAMP_MIN_FPS) * (
        1.0 - math.exp(-n / float(RAMP_HALF_LIFE_FRAMES))
    )
    frame_sec = 1.0 / max(fps, 0.001)  # safety clamp

    vid_name = f"{uuid.uuid4()}.mp4"
    vid_path = videos_dir / vid_name
    listfile = videos_dir / f"list_{uuid.uuid4()}.txt"

    # Write concat list with the SAME per-frame duration derived above.
    # (If you ever want variable per-frame durations, you can replace 'frame_sec'
    #  per line with your own sequence.)
    with listfile.open("w") as f:
        for p in ordered_files:
            fpath = p.as_posix().replace("'", "'\\''")
            f.write(f"file '{fpath}'\n")
            f.write(f"duration {frame_sec:.6f}\n")
        # Repeat last frame once with NO duration, per concat demuxer rules
        last_path = ordered_files[-1].as_posix().replace("'", "'\\''")
        f.write(f"file '{last_path}'\n")

    proc = subprocess.run(
        [
            "ffmpeg",
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
    )
    listfile.unlink(missing_ok=True)

    if proc.returncode != 0:
        return Response(
            status_code=500,
            content=f"ffmpeg failed:\n{proc.stderr.decode('utf-8', errors='ignore')[:4000]}",
        )

    session_prefix = session or "_default"
    return {"video_url": f"/videos/{session_prefix}/{vid_name}"}


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
