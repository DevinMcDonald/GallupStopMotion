import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  resolveUrl,
  uploadFrame,
  deleteLastFrame,
  buildVideo,
  startFreshSession,
} from "./lib/backend";

export default function StopMotionApp() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const playbackRef = useRef(null);

  const [streamReady, setStreamReady] = useState(false);
  const [thumbnails, setThumbnails] = useState([]);  // { id, url }
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSrc, setPlaybackSrc] = useState("");
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [loadingPlayback, setLoadingPlayback] = useState(false);
  const [error, setError] = useState("");
  const [needsFullscreen, setNeedsFullscreen] = useState(true); // prompt for FS in create mode

  // --- Ensure fullscreen kiosk mode (create + playback) ---
  const enterFullscreen = useCallback(async () => {
    const node = containerRef.current;
    if (!node) return;
    try {
      if (!document.fullscreenElement) {
        await node.requestFullscreen();
      }
      setNeedsFullscreen(false);
    } catch {
      // Blocked by browser until user interaction. We'll keep showing the prompt.
      setNeedsFullscreen(true);
    }
  }, []);

  useEffect(() => {
    // Attempt on first load; many browsers require a user gesture, so the prompt will handle it.
    enterFullscreen();
    const onFsChange = () => setNeedsFullscreen(!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [enterFullscreen]);

  // Also re-attempt fullscreen on any main user gesture
  const ensureFS = useCallback(async () => {
    if (!document.fullscreenElement) await enterFullscreen();
  }, [enterFullscreen]);

  // --- Start a fresh session on load (clears previous content) ---
  useEffect(() => {
    (async () => {
      try {
        await startFreshSession();
        setThumbnails([]); // clear client-side too
      } catch {}
    })();
  }, []);

  // --- Start webcam as the background ---
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (!active) return;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setStreamReady(true);
        }
      } catch {
        setError("Camera access denied. Please allow webcam.");
      }
    })();

    return () => {
      active = false;
      try {
        const s = videoRef.current?.srcObject;
        s && s.getTracks().forEach((t) => t.stop());
      } catch {}
    };
  }, []);

  // --- Capture a frame and upload ---
  const handleCapture = useCallback(async () => {
    await ensureFS();
    if (!videoRef.current || !canvasRef.current) return;
    setIsCapturing(true);
    setError("");

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) throw new Error("Video not ready");

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, w, h);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("Failed to capture frame");

      // Show local thumb immediately
      const tempId = `local-${Date.now()}`;
      const localUrl = URL.createObjectURL(blob);
      setThumbnails((prev) => [{ id: tempId, url: localUrl }, ...prev].slice(0, 30));

      // Upload to backend
      const data = await uploadFrame(blob); // { id, thumbnail_url? }
      if (data?.thumbnail_url) {
        const resolved = resolveUrl(data.thumbnail_url);
        setThumbnails((prev) => [
          { id: data.id || tempId, url: resolved },
          ...prev.filter((t) => t.id !== tempId),
        ].slice(0, 30));
      }
    } catch (e) {
      setError(e.message || "Capture failed");
    } finally {
      setIsCapturing(false);
    }
  }, [ensureFS]);

  // --- Undo last frame ---
  const handleUndo = useCallback(async () => {
    await ensureFS();
    setThumbnails((prev) => prev.slice(1));
    try { await deleteLastFrame(); } catch {}
  }, [ensureFS]);

  // --- Reset all (clear current session) ---
  const handleResetAll = useCallback(async () => {
    await ensureFS();
    setThumbnails([]);
    try {
      // reuse backend.resetAll via startFreshSession for simplicity
      await startFreshSession();
    } catch (e) {
      setError(e.message || "Reset failed");
    }
  }, [ensureFS]);

  // --- Build video and play fullscreen with robust timing ---
  const handlePlay = useCallback(async () => {
    await ensureFS();
    setLoadingPlayback(true);
    setAutoplayBlocked(false);
    setError("");

    try {
      const { video_url } = await buildVideo();
      if (!video_url) throw new Error("No video_url returned");

      // Prefer proxy (5173) when API_BASE is empty; cache-bust to avoid stale loads
      const abs = resolveUrl(video_url) + `?t=${Date.now()}`;

      // Update state so React mounts the player
      setPlaybackSrc(abs);
      setIsPlaying(true);

      // Wait for the <video> to mount (up to ~1s)
      for (let i = 0; i < 60 && !playbackRef.current; i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => requestAnimationFrame(r));
      }
      const vid = playbackRef.current;
      if (!vid) throw new Error("Player not ready");

      // Ensure source and load
      vid.src = abs;
      vid.load();

      // Wait for metadata or immediate error
      await new Promise((resolve, reject) => {
        const onMeta = () => { cleanup(); resolve(); };
        const onErr = () => { cleanup(); reject(new Error("Video tag error")); };
        function cleanup() {
          vid.removeEventListener("loadedmetadata", onMeta);
          vid.removeEventListener("error", onErr);
        }
        vid.addEventListener("loadedmetadata", onMeta, { once: true });
        vid.addEventListener("error", onErr, { once: true });
      });

      // Try to autoplay; if blocked, show tap-to-play
      await vid.play().catch(() => setAutoplayBlocked(true));
    } catch (e) {
      console.error("playback failed:", e);
      setError("Playback failed");
      setIsPlaying(false);
      setPlaybackSrc("");
      if (document.fullscreenElement) document.exitFullscreen();
    } finally {
      setLoadingPlayback(false);
    }
  }, [ensureFS]);

  // Exit playback when fullscreen exits (ESC)
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setIsPlaying(false);
        setPlaybackSrc("");
        setAutoplayBlocked(false);
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative h-screen w-screen bg-black overflow-hidden text-white select-none"
      onPointerDown={ensureFS}   // any tap/click should (re)enter fullscreen
    >
      {/* Live camera background */}
      <video
        ref={videoRef}
        muted
        playsInline
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${isPlaying ? "opacity-0" : "opacity-100"}`}
      />

      {/* Fullscreen prompt (create mode) */}
      {!isPlaying && needsFullscreen && (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            onClick={enterFullscreen}
            className="px-6 py-3 bg-white text-black rounded-2xl shadow"
          >
            Tap to enter Fullscreen
          </button>
        </div>
      )}

      {/* Build mode UI */}
      {!isPlaying && (
        <>
          <div className="absolute top-4 left-4 bg-black/60 px-3 py-1 rounded-xl text-sm backdrop-blur">
            {streamReady ? "Live" : "Starting Camera..."}
          </div>

          <div className="absolute top-4 right-4 flex gap-2">
            <button onClick={handleUndo} className="px-4 py-2 bg-white text-black rounded-xl shadow">Undo</button>
            <button onClick={handleResetAll} className="px-4 py-2 bg-white text-black rounded-xl shadow">Reset All</button>
            <button onClick={handlePlay} disabled={loadingPlayback} className="px-4 py-2 bg-white text-black rounded-xl shadow">
              {loadingPlayback ? "Building..." : "Play"}
            </button>
          </div>

          {/* Film roll in lower third */}
          <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/70 to-transparent p-4 flex items-end">
            <div className="flex overflow-x-auto gap-3 flex-1">
              {thumbnails.length === 0 && (
                <div className="text-white/80 text-sm">No frames yet — press Capture to add one.</div>
              )}
              {thumbnails.map((t) => (
                <img key={t.id} src={t.url} alt="" className="h-28 object-cover rounded-lg border-4 border-black shadow" />
              ))}
            </div>

            <button
              onClick={handleCapture}
              disabled={!streamReady || isCapturing}
              className="ml-4 h-16 w-16 bg-white rounded-full grid place-items-center shadow"
              title="Capture frame"
            >
              <div className={`h-10 w-10 rounded-full ${isCapturing ? "bg-gray-400 animate-pulse" : "bg-red-500"}`} />
            </button>
          </div>
        </>
      )}

      {/* Playback takeover */}
      {isPlaying && (
        <div className="absolute inset-0 bg-black">
          <video
            key={playbackSrc}               // force remount on new src
            ref={playbackRef}
            className="absolute inset-0 h-full w-full object-contain"
            playsInline
            muted
            autoPlay
            preload="auto"
            onEnded={() => document.exitFullscreen()}
            onError={(e) => {
              const err = e.currentTarget?.error;
              console.error("video error", err?.code, err?.message);
              setError("Video playback error");
              setIsPlaying(false);
              setPlaybackSrc("");
              setAutoplayBlocked(false);
            }}
          >
            <source src={playbackSrc} type="video/mp4" />
          </video>

          {autoplayBlocked && (
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                className="px-6 py-3 bg-white text-black rounded-xl shadow"
                onClick={async () => {
                  try { await playbackRef.current?.play(); setAutoplayBlocked(false); } catch {}
                }}
              >
                Tap to Play
              </button>
            </div>
          )}
        </div>
      )}

      {/* Hidden canvas used for capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Error toast */}
      {error && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-red-600 px-4 py-2 rounded shadow">
          {error}
        </div>
      )}
    </div>
  );
}
