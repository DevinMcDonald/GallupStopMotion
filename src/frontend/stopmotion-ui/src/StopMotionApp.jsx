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
  const playbackRef = useRef(null);

  const [streamReady, setStreamReady] = useState(false);
  const [thumbnails, setThumbnails] = useState([]);  // { id, url }
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSrc, setPlaybackSrc] = useState("");
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [loadingPlayback, setLoadingPlayback] = useState(false);
  const [error, setError] = useState("");
  const [showDevHelp, setShowDevHelp] = useState(import.meta.env.DEV); // visible only in dev

  // --- Fresh session on load ---
  useEffect(() => {
    (async () => {
      try {
        await startFreshSession();
        setThumbnails([]);
      } catch {}
    })();
  }, []);

  // --- Webcam background ---
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

  // --- Capture & upload ---
  const handleCapture = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    if (isCapturing) return;
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

      const tempId = `local-${Date.now()}`;
      const localUrl = URL.createObjectURL(blob);
      setThumbnails((prev) => [{ id: tempId, url: localUrl }, ...prev].slice(0, 30));

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
  }, [isCapturing]);

  // --- Undo last frame ---
  const handleUndo = useCallback(async () => {
    setThumbnails((prev) => prev.slice(1));
    try { await deleteLastFrame(); } catch {}
  }, []);

  // --- Reset all ---
  const handleResetAll = useCallback(async () => {
    setThumbnails([]);
    try { await startFreshSession(); } catch (e) { setError(e.message || "Reset failed"); }
  }, []);

  // --- Build & play (no fullscreen API) ---
  const handlePlay = useCallback(async () => {
    if (loadingPlayback) return;
    setLoadingPlayback(true);
    setAutoplayBlocked(false);
    setError("");

    try {
      const { video_url } = await buildVideo();
      if (!video_url) throw new Error("No video_url returned");

      const abs = resolveUrl(video_url) + `?t=${Date.now()}`;
      setPlaybackSrc(abs);
      setIsPlaying(true);

      for (let i = 0; i < 60 && !playbackRef.current; i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => requestAnimationFrame(r));
      }
      const vid = playbackRef.current;
      if (!vid) throw new Error("Player not ready");

      vid.src = abs;
      vid.load();

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

      await vid.play().catch(() => setAutoplayBlocked(true));
    } catch (e) {
      console.error("playback failed:", e);
      setError("Playback failed");
      setIsPlaying(false);
      setPlaybackSrc("");
    } finally {
      setLoadingPlayback(false);
    }
  }, [loadingPlayback]);

  // --- Keyboard controls (dev & prod) ---
  useEffect(() => {
    const onKey = async (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();

      // Helpful defaults
      if (k === " " || k === "c") {        // Space or C: capture
        e.preventDefault();
        await handleCapture();
        return;
      }
      if (k === "z" || k === "u") {        // Z or U: undo
        e.preventDefault();
        await handleUndo();
        return;
      }
      if (k === "r") {                     // R: reset all
        e.preventDefault();
        await handleResetAll();
        return;
      }
      if (k === "p" || k === "enter") {    // P or Enter: play
        e.preventDefault();
        await handlePlay();
        return;
      }
      if (k === "escape") {                // Esc: stop playback
        if (isPlaying) {
          setIsPlaying(false);
          setPlaybackSrc("");
          setAutoplayBlocked(false);
        }
        return;
      }
      // toggle dev help with "?" (Shift+/) — dev only
      if (import.meta.env.DEV && (e.key === "?" || (k === "/" && e.shiftKey))) {
        setShowDevHelp((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleCapture, handleUndo, handleResetAll, handlePlay, isPlaying]);

  return (
    <div className="relative h-screen w-screen bg-black overflow-hidden text-white select-none">
      {/* Live camera background */}
      <video
        ref={videoRef}
        muted
        playsInline
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${isPlaying ? "opacity-0" : "opacity-100"}`}
      />

      {/* Build mode UI (no on-screen buttons) */}
      {!isPlaying && (
        <>
          <div className="absolute top-4 left-4 bg-black/60 px-3 py-1 rounded-xl text-sm backdrop-blur">
            {streamReady ? "Live" : "Starting Camera..."}
          </div>

          {/* Film roll in lower third */}
          <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/70 to-transparent p-4 flex items-end">
            <div className="flex overflow-x-auto gap-3 flex-1">
              {thumbnails.length === 0 && (
                <div className="text-white/80 text-sm">No frames yet — press <span className="font-semibold">Space</span> to capture.</div>
              )}
              {thumbnails.map((t) => (
                <img key={t.id} src={t.url} alt="" className="h-28 object-cover rounded-lg border-4 border-black shadow" />
              ))}
            </div>
          </div>
        {/* Dev helper overlay (visible only in dev builds) */}
        {import.meta.env.DEV && showDevHelp && (
          <div className="absolute top-4 right-4 bg-black/70 text-white text-sm rounded-xl p-4 leading-6 shadow-lg backdrop-blur-md">
            <div className="font-semibold mb-1">Dev Controls</div>
            <div><span className="font-mono">Space</span> or <span className="font-mono">C</span> — Capture</div>
            <div><span className="font-mono">Z</span> or <span className="font-mono">U</span> — Undo last</div>
            <div><span className="font-mono">R</span> — Reset session</div>
            <div><span className="font-mono">P</span> or <span className="font-mono">Enter</span> — Play</div>
            <div><span className="font-mono">Esc</span> — Stop playback</div>
            <div className="mt-1 opacity-80"><span className="font-mono">?</span> to hide</div>
          </div>
        )}
        </>
      )}

      {/* Playback takeover (fills the app) */}
      {isPlaying && (
        <div className="absolute inset-0 bg-black">
          <video
            key={playbackSrc}
            ref={playbackRef}
            className="absolute inset-0 h-full w-full object-contain"
            playsInline
            muted
            autoPlay
            preload="auto"
            onEnded={() => {
              setIsPlaying(false);
              setPlaybackSrc("");
              setAutoplayBlocked(false);
            }}
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
