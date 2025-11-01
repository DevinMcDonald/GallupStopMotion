import React, { useEffect, useRef, useState, useCallback } from "react";

// --- Config & Helpers ---
const API_BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:8000").replace(/\/$/, "");

const resolveUrl = (u) => {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u; // already absolute
  const path = u.startsWith("/") ? u : `/${u}`;
  return `${API_BASE}${path}`;
};

export default function StopMotionApp() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const playbackRef = useRef(null);

  const [streamReady, setStreamReady] = useState(false);
  const [thumbnails, setThumbnails] = useState([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSrc, setPlaybackSrc] = useState("");
  const [error, setError] = useState("");
  const [loadingPlayback, setLoadingPlayback] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // --- Start Webcam ---
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
      } catch (e) {
        setError("Camera access denied. Please allow webcam.");
      }
    })();

    return () => {
      active = false;
      try {
        const s = videoRef.current?.srcObject;
        s && s.getTracks().forEach((t) => t.stop());
      } catch (_) {}
    };
  }, []);

  // --- Capture Frame ---
  const handleCapture = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setIsCapturing(true);
    setError("");

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const w = video.videoWidth;
      const h = video.videoHeight;

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, w, h);

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9)
      );

      const localUrl = URL.createObjectURL(blob);
      const tempId = `local-${Date.now()}`;
      setThumbnails((prev) => [{ id: tempId, url: localUrl }, ...prev].slice(0, 30));

      const form = new FormData();
      form.append("frame", blob, `${Date.now()}.jpg`);

      const res = await fetch(`${API_BASE}/api/frames`, { method: "POST", body: form });
      const data = await res.json();

      if (data?.thumbnail_url) {
        setThumbnails((prev) => [
          { id: data.id, url: resolveUrl(data.thumbnail_url) },
          ...prev.filter((t) => t.id !== tempId),
        ]);
      }
    } catch (e) {
      setError("Failed to capture");
    } finally {
      setIsCapturing(false);
    }
  }, []);

  // --- Undo Last Frame ---
  const handleUndo = useCallback(async () => {
    setThumbnails((prev) => prev.slice(1));
    try { await fetch(`${API_BASE}/api/frames/last`, { method: "DELETE" }); } catch (_) {}
  }, []);

  // --- Build & Play Video ---
  const handlePlay = useCallback(async () => {
    setLoadingPlayback(true);
    setAutoplayBlocked(false);
    setError("");

    try {
      const container = containerRef.current;
      if (container && !document.fullscreenElement) {
        await container.requestFullscreen().catch(() => {});
      }

      const res = await fetch(`${API_BASE}/api/video`, { method: "POST" });
      const { video_url } = await res.json();
      const abs = resolveUrl(video_url) + `?t=${Date.now()}`;

      setPlaybackSrc(abs);
      setIsPlaying(true);

      const vid = playbackRef.current;
      vid.src = abs;
      vid.load();

      await new Promise((r) =>
        vid.addEventListener("loadedmetadata", r, { once: true })
      );

      await vid.play().catch(() => setAutoplayBlocked(true));
    } catch (e) {
      setError("Playback failed.");
      setIsPlaying(false);
      setPlaybackSrc("");
      if (document.fullscreenElement) document.exitFullscreen();
    } finally {
      setLoadingPlayback(false);
    }
  }, []);

  // Exit playback when fullscreen exits
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
    <div ref={containerRef} className="relative h-screen w-screen bg-black overflow-hidden text-white select-none">

      {/* Webcam Background */}
      <video ref={videoRef} muted playsInline className={`absolute inset-0 h-full w-full object-cover ${isPlaying ? "opacity-0" : "opacity-100"}`} />

      {/* BUILD MODE UI */}
      {!isPlaying && (
        <>
          <div className="absolute top-4 left-4 bg-black/60 px-3 py-1 rounded-xl text-sm backdrop-blur">
            {streamReady ? "Live" : "Starting Camera..."}
          </div>

          <div className="absolute top-4 right-4 flex gap-2">
            <button onClick={handleUndo} className="px-4 py-2 bg-white text-black rounded-xl shadow">Undo</button>
            <button onClick={handlePlay} disabled={loadingPlayback} className="px-4 py-2 bg-white text-black rounded-xl shadow">
              {loadingPlayback ? "Building..." : "Play"}
            </button>
          </div>

          {/* Film Roll */}
          <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/70 to-transparent p-4 flex items-end">
            <div className="flex overflow-x-auto gap-3 flex-1">
              {thumbnails.map((t) => (
                <img key={t.id} src={t.url} className="h-28 object-cover rounded-lg border-4 border-black shadow" />
              ))}
            </div>

            <button onClick={handleCapture} disabled={!streamReady || isCapturing}
              className="ml-4 h-16 w-16 bg-white rounded-full grid place-items-center shadow">
              <div className={`h-10 w-10 rounded-full ${isCapturing ? "bg-gray-400 animate-pulse" : "bg-red-500"}`} />
            </button>
          </div>
        </>
      )}

      {/* PLAYBACK MODE */}
      {isPlaying && (
        <div className="absolute inset-0 bg-black">
          <video
            ref={playbackRef}
            className="absolute inset-0 h-full w-full object-contain"
            playsInline
            muted
            autoPlay
            preload="auto"
            onEnded={() => document.exitFullscreen()}
          />

          {autoplayBlocked && (
            <div className="absolute inset-0 flex items-center justify-center">
              <button className="px-6 py-3 bg-white text-black rounded-xl" onClick={() => playbackRef.current.play()}>
                Tap to Play
              </button>
            </div>
          )}
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />

      {error && <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-red-600 px-4 py-2 rounded shadow">{error}</div>}
    </div>
  );
}
