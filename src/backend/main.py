import subprocess
import uuid
from pathlib import Path
from typing import List

from fastapi import FastAPI, File, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# ---------- Config ----------
ORIGIN = "http://localhost:5173"  # frontend dev server
PORT = 8000  # backend port

BASE_DIR = Path(__file__).resolve().parent
FRAMES_DIR = BASE_DIR / "session_frames"
VIDEO_DIR = BASE_DIR / "videos"
FRAMES_DIR.mkdir(exist_ok=True)
VIDEO_DIR.mkdir(exist_ok=True)

# ---------- App ----------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[ORIGIN],  # tighten this in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# serve saved frames & videos (for quick dev)
app.mount("/frames", StaticFiles(directory=str(FRAMES_DIR)), name="frames")
app.mount("/videos", StaticFiles(directory=str(VIDEO_DIR)), name="videos")


@app.get("/api/health")
def health():
    return {"ok": True}


# ---------- Endpoints expected by the UI ----------


@app.post("/api/frames")
async def upload_frame(frame: UploadFile = File(...)):
    """
    Accepts a JPEG (multipart field name: 'frame').
    Saves to session_frames and returns id + a URL to fetch it back if needed.
    """
    # ensure jpeg-ish content (not strictly required)
    if not frame.filename.lower().endswith((".jpg", ".jpeg")):
        # allow any extension, but default to .jpg
        ext = ".jpg"
    else:
        ext = Path(frame.filename).suffix.lower()

    fid = f"{uuid.uuid4()}{ext}"
    out = FRAMES_DIR / fid

    # write file
    content = await frame.read()
    out.write_bytes(content)

    # return a path that the frontend can load
    return {"id": fid, "thumbnail_url": f"/frames/{fid}"}


@app.delete("/api/frames/last", status_code=204)
def delete_last():
    """
    Removes the most recent frame (lexicographically last filename).
    """
    files: List[Path] = sorted(FRAMES_DIR.glob("*"))
    if files:
        files[-1].unlink(missing_ok=True)


@app.post("/api/video")
def build_video():
    """
    Concatenate all frames into an mp4 and return its URL.
    - Uses ffmpeg concat demuxer.
    - ~30fps (0.0333s per frame).
    """
    files = sorted(FRAMES_DIR.glob("*"))
    if not files:
        return Response(status_code=400, content="No frames to build")

    vid_name = f"{uuid.uuid4()}.mp4"
    vid_path = VIDEO_DIR / vid_name

    listfile = VIDEO_DIR / f"list_{uuid.uuid4()}.txt"
    with listfile.open("w") as f:
        for p in files:
            # escape single quotes for safety
            fpath = p.as_posix().replace("'", "'\\''")
            f.write(f"file '{fpath}'\n")
            f.write("duration 0.0333\n")  # ~30 fps

    # Use ffmpeg to build the video
    # Requires: brew install ffmpeg (macOS)
    proc = subprocess.run(
        [
            "ffmpeg",
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
        # surface ffmpeg error to help debugging
        return Response(
            status_code=500,
            content=f"ffmpeg failed:\n{proc.stderr.decode('utf-8', errors='ignore')[:4000]}",
        )

    # Optionally clear frames after build:
    # for p in files: p.unlink(missing_ok=True)

    return {"video_url": f"/videos/{vid_name}"}
