import json
import subprocess
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# ----------------- Config -----------------
ORIGIN = "http://localhost:5173"  # your Vite dev origin
PORT = 8000

BASE_DIR = Path(__file__).resolve().parent
FRAMES_ROOT = BASE_DIR / "session_frames"  # frames/<session>/
VIDEOS_ROOT = BASE_DIR / "videos"  # videos/<session>/
FRAMES_ROOT.mkdir(exist_ok=True)
VIDEOS_ROOT.mkdir(exist_ok=True)

MANIFEST_NAME = "frames.json"  # kept inside each session's frames dir

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
            # If corrupt, fall back to ordering by numeric prefix of files
            return []
    return []


def save_manifest(manifest_path: Path, items: list[dict[str, Any]]):
    tmp = manifest_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, indent=2))
    tmp.replace(manifest_path)


def next_index(manifest: list[dict[str, Any]]) -> int:
    return (manifest[-1]["index"] + 1) if manifest else 1


# ----------------- Routes -----------------


@app.post("/api/frames")
async def upload_frame(
    frame: UploadFile = File(...), session: str | None = Query(default=None)
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

    # write file
    content = await frame.read()
    out.write_bytes(content)

    # update manifest
    manifest.append({"index": idx, "file": filename})
    save_manifest(manifest_path, manifest)

    # return a path that the frontend can load (served via StaticFiles)
    # note: include session subdir in returned URL
    session_prefix = session or "_default"
    return {"id": idx, "thumbnail_url": f"/frames/{session_prefix}/{filename}"}


@app.delete("/api/frames/last", status_code=204)
def delete_last(session: str | None = Query(default=None)):
    """Remove the most recent frame (by capture order) for this session."""
    frames_dir, _, manifest_path = session_dirs(session)
    manifest = load_manifest(manifest_path)

    if not manifest:
        return Response(status_code=204)

    last = manifest.pop()  # last captured
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
    # clear manifest
    save_manifest(manifest_path, [])
    return {"deleted": deleted}


@app.post("/api/video")
def build_video(session: str | None = Query(default=None)):
    """
    Build an MP4 strictly in capture order using the session's manifest.
    Uses ffmpeg concat demuxer and repeats the last frame once so duration is preserved.
    """
    frames_dir, videos_dir, manifest_path = session_dirs(session)
    manifest = load_manifest(manifest_path)

    # If no manifest yet (old sessions), fall back to numeric filename order
    if not manifest:
        # gather numeric-prefix jpgs
        files = sorted([p for p in frames_dir.glob("*.jpg")], key=lambda p: p.name)
        manifest = [{"index": i + 1, "file": p.name} for i, p in enumerate(files)]
        save_manifest(manifest_path, manifest)

    if not manifest:
        return Response(status_code=400, content="No frames to build")

    # Verify files exist (manifest may be stale)
    ordered_files = [
        frames_dir / item["file"]
        for item in manifest
        if (frames_dir / item["file"]).exists()
    ]
    if not ordered_files:
        return Response(status_code=400, content="No frames to build")

    # Write concat list in manifest order
    vid_name = f"{uuid.uuid4()}.mp4"
    vid_path = videos_dir / vid_name
    listfile = videos_dir / f"list_{uuid.uuid4()}.txt"

    with listfile.open("w") as f:
        for p in ordered_files:
            # escape single quotes
            fpath = p.as_posix().replace("'", "'\\''")
            f.write(f"file '{fpath}'\n")
            f.write("duration 0.0333\n")  # ~30fps
        # repeat last frame without duration per ffmpeg concat-demuxer requirement
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
