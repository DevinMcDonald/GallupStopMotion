import React, { useEffect, useRef, useState, useCallback } from "react";

/**
 * StopMotionApp — museum kiosk prototype
 *
 * Requirements addressed:
 * 1) Live webcam feed dominates the background while building.
 * 2) Film‑roll of most recent pictures in the lower third.
 * 3) Full‑screen takeover during playback.
 *
 * Integration: point API_BASE to your Python backend. See notes below.
 */

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000"; // e.g., FastAPI server

export default function StopMotionApp() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const playbackRef = useRef(null);

  const [streamReady, setStreamReady] = useState(false);
  const [thumbnails, setThumbnails] = useState([]); // { id, url }
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSrc, setPlaybackSrc] = useState("");
  const [error, setError] = useState("");

  // Start webcam
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!active) return;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setStreamReady(true);
        }
      } catch (e) {
        console.error(e);
        setError("Camera access failed. Please allow webcam permissions.");
      }
    })();
    return () => { active = false; try { const s = videoRef.current?.srcObject; s && s.getTracks().forEach(t => t.stop()); } catch (_) {} };
  }, []);

  // Capture current frame from live video and upload to backend
  const handleCapture = useCallback(async () => {
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
      // Convert to blob for upload
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("Failed to capture frame");

      // Show local thumb immediately
      const localUrl = URL.createObjectURL(blob);
      const tempId = `local-${Date.now()}`;
      setThumbnails(prev => [{ id: tempId, url: localUrl }, ...prev].slice(0, 30));

      // Upload to backend (browser-capture mode)
      const form = new FormData();
      form.append("frame", blob, `${Date.now()}.jpg`);
      const res = await fetch(`${API_BASE}/api/frames`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);

      // Optionally replace temp thumb with canonical one from backend
      const data = await res.json(); // { id, thumbnail_url? }
      if (data?.thumbnail_url) {
        setThumbnails(prev => [{ id: data.id || tempId, url: data.thumbnail_url }, ...prev.filter(t => t.id !== tempId)].slice(0, 30));
      }
    } catch (e) {
      console.error(e);
      setError(e.message || "Capture failed");
    } finally {
      setIsCapturing(false);
    }
  }, []);

  // Undo last frame (client + backend best effort)
  const handleUndo = useCallback(async () => {
    setThumbnails(prev => prev.slice(1));
    try {
      await fetch(`${API_BASE}/api/frames/last`, { method: "DELETE" });
    } catch (_) { /* ignore for kiosk resilience */ }
  }, []);

  // Compile and play full-screen video
  const handlePlay = useCallback(async () => {
    setError("");
    try {
      // Ask backend to build video and return a URL
      const res = await fetch(`${API_BASE}/api/video`, { method: "POST" });
      if (!res.ok) throw new Error("Video build failed");
      const { video_url } = await res.json();
      setPlaybackSrc(video_url);
      setIsPlaying(true);

      // Enter fullscreen on the container so the video can cover everything
      const node = containerRef.current;
      if (node && !document.fullscreenElement) {
        await node.requestFullscreen();
      }

      // Autoplay when src is set
      setTimeout(() => {
        playbackRef.current?.play?.();
      }, 50);
    } catch (e) {
      console.error(e);
      setError(e.message || "Playback failed");
    }
  }, []);

  // Exit playback mode when video ends or on ESC/fullscreen change
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && isPlaying) {
        setIsPlaying(false);
        setPlaybackSrc("");
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [isPlaying]);

  return (
    <div ref={containerRef} className="relative h-screen w-screen bg-black overflow-hidden select-none">
      {/* Live camera background */}
      <video
        ref={videoRef}
        muted
        playsInline
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${isPlaying ? "opacity-0" : "opacity-100"}`}
      />

      {/* Build mode overlay UI */}
      {!isPlaying && (
        <div className="absolute inset-0 flex flex-col justify-end pointer-events-none">
          {/* Top-left status */}
          <div className="absolute top-4 left-4 pointer-events-auto">
            <div className="px-3 py-1 rounded-xl bg-black/50 text-white text-sm backdrop-blur">
              {streamReady ? "Live" : "Starting camera…"}
            </div>
          </div>

          {/* Controls */}
          <div className="absolute top-4 right-4 flex gap-2 pointer-events-auto">
            <button onClick={handleUndo} className="px-4 py-2 rounded-2xl bg-white/90 hover:bg-white text-black shadow">Undo</button>
            <button onClick={handlePlay} className="px-4 py-2 rounded-2xl bg-white/90 hover:bg-white text-black shadow">Play</button>
          </div>

          {/* Film roll in lower third */}
          <div className="relative w-full h-1/3">
            {/* gradient mask */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />

            <div className="relative z-10 h-full px-4 pb-4 flex items-end">
              <div className="w-full overflow-x-auto pointer-events-auto">
                <div className="flex gap-3 items-end min-h-[140px]">
                  {thumbnails.length === 0 && (
                    <div className="text-white/80 text-sm">No frames yet — press Capture to add one.</div>
                  )}
                  {thumbnails.map((t) => (
                    <div key={t.id} className="shrink-0">
                      <div className="rounded-xl overflow-hidden border-4 border-black shadow-lg">
                        <img src={t.url} alt="frame" className="h-28 w-auto object-cover" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="ml-4 pointer-events-auto">
                <button
                  onClick={handleCapture}
                  disabled={isCapturing || !streamReady}
                  className="h-16 w-16 rounded-full bg-white hover:scale-105 active:scale-95 transition shadow-xl grid place-items-center"
                  title="Capture frame"
                >
                  <div className={`h-10 w-10 rounded-full ${isCapturing ? "bg-gray-400 animate-pulse" : "bg-red-500"}`} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Playback takeover */}
      {isPlaying && (
        <div className="absolute inset-0 bg-black">
          <video
            ref={playbackRef}
            src={playbackSrc}
            className="absolute inset-0 h-full w-full object-contain"
            onEnded={() => {
              if (document.fullscreenElement) document.exitFullscreen();
              setIsPlaying(false);
              setPlaybackSrc("");
            }}
            controls={false}
            autoPlay
          />
        </div>
      )}

      {/* Hidden canvas used for capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Error toast */}
      {error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl bg-red-600 text-white shadow pointer-events-none">
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * Backend API contract (expectations):
 *
 * POST /api/frames
 *   body: multipart/form-data { frame: <image/jpeg> }
 *   -> 201 { id: string, thumbnail_url?: string }
 *   (Server stores the frame to a session folder and optionally returns a CDN/URL for thumb)
 *
 * DELETE /api/frames/last
 *   -> 204 (removes the most recent frame if present)
 *
 * POST /api/video
 *   -> 200 { video_url: string }
 *   (Server stitches frames into a video; returns a URL to mp4/webm)
 *
 * CORS: allow the kiosk origin. Consider persisting a session id via cookie/localStorage.
 */
