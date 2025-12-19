import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  resolveUrl,
  uploadFrame,
  deleteLastFrame,
  buildVideo,
  startFreshSession,
  finalizeShare,
  rotateSessionId,
  getForwarderStatus,
} from "./lib/backend";

const DEFAULT_ZOOM_CONFIG = {
  zoom: 1,
  zoomMin: 1,
  zoomMax: 2.5,
  zoomStep: 0.1,
  maxFrames: 240,
};
const FRONTEND_MAX_FRAMES = DEFAULT_ZOOM_CONFIG.maxFrames;
const IS_DEV = import.meta.env.DEV;

export default function StopMotionApp() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const playbackRef = useRef(null);

  const [streamReady, setStreamReady] = useState(false);
  const [thumbnails, setThumbnails] = useState([]); // { id, url }
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSrc, setPlaybackSrc] = useState("");
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [loadingPlayback, setLoadingPlayback] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeBlink, setNoticeBlink] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [serialMissing, setSerialMissing] = useState(false);
  const [pendingResetConfirm, setPendingResetConfirm] = useState(false);
  const [shareOverlay, setShareOverlay] = useState(null); // { url, expiresAt, key }
  const [zoom, setZoom] = useState(DEFAULT_ZOOM_CONFIG.zoom);
  const [zoomConfig, setZoomConfig] = useState(DEFAULT_ZOOM_CONFIG);
  const [showDevHelp, setShowDevHelp] = useState(IS_DEV); // visible only in dev
  const [wsInfo, setWsInfo] = useState({ connected: false, url: "", last: "" }); // dev-only badge
  const [cameras, setCameras] = useState([]);
  const [activeCamera, setActiveCamera] = useState(null);
  const [lastActivity, setLastActivity] = useState(Date.now());

  // Inactivity timings (tunable; shortened defaults for testing)
  const WARN_MS = 120_000;
  const TIMEOUT_MS = 180_000;

  const bumpActivity = useCallback(() => {
    setLastActivity(Date.now());
    setNotice((n) =>
      n?.startsWith("Inactivity") || n?.startsWith("Approaching") ? "" : n,
    );
  }, []);

  // --- Fresh session on load ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      try {
        await startFreshSession();
        setThumbnails([]);
        setFrameCount(0);
      } catch {
        // ignore reset errors here; UI will show failures on demand
      }
    })();

    // Load zoom config (optional public/config.json) and persisted zoom
    (async () => {
      let cfg = { ...DEFAULT_ZOOM_CONFIG };
      try {
        const res = await fetch("/config.json", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          cfg = { ...cfg, ...data };
        }
      } catch {
        // ignore missing/parse errors
      }
      setZoomConfig(cfg);
      try {
        const stored = localStorage.getItem("gsm-zoom");
        const base = stored ? parseFloat(stored) : cfg.zoom;
        if (!Number.isNaN(base)) {
          const clamped = Math.max(cfg.zoomMin, Math.min(cfg.zoomMax, base));
          setZoom(clamped);
        } else {
          setZoom(cfg.zoom);
        }
      } catch {
        setZoom(cfg.zoom);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeCamera]);

  // --- Webcam background ---
  useEffect(() => {
    let active = true;
    let currentStream;

    (async () => {
      try {
        // 1) Prime permissions so device labels are available in some browsers
        await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });

        // 2) Enumerate and pick the selected camera (or last as fallback)
        const devices = await navigator.mediaDevices.enumerateDevices();
        const camDevices = devices.filter((d) => d.kind === "videoinput");
        setCameras(camDevices);
        if (camDevices.length === 0) throw new Error("No cameras found.");
        const selectedId =
          camDevices.find((c) => c.deviceId === activeCamera)?.deviceId ||
          camDevices[camDevices.length - 1].deviceId;
        if (!activeCamera) {
          // set and re-run effect to avoid double-opening streams
          setActiveCamera(selectedId);
          return;
        }

        // 3) Open that specific device with your preferred resolution
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: selectedId },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        currentStream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setStreamReady(true);
        }
      } catch (err) {
        console.error(err);
        setError(
          "Unable to access the external camera. Check permissions and connections.",
        );
      }
    })();

    // Cleanup: stop tracks when the component unmounts or effect re-runs
    return () => {
      active = false;
      if (currentStream) currentStream.getTracks().forEach((t) => t.stop());
    };
  }, [activeCamera]);

  // --- Capture & upload ---
  const handleCapture = useCallback(async () => {
    if (shareOverlay) return; // dismiss first
    bumpActivity();
    if (pendingResetConfirm) setPendingResetConfirm(false);
    setNotice("");
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

      const maxFrames = zoomConfig.maxFrames || DEFAULT_ZOOM_CONFIG.maxFrames;
      if (frameCount >= maxFrames) {
        setError(`Frame limit reached (${maxFrames}).`);
        return;
      }
      if (frameCount >= 0.9 * maxFrames) {
        setNotice(`Approaching max length: ${frameCount}/${maxFrames} frames`);
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      // Crop toward center based on zoom factor
      const zoomFactor = Math.max(
        zoomConfig.zoomMin || DEFAULT_ZOOM_CONFIG.zoomMin,
        Math.min(zoomConfig.zoomMax || DEFAULT_ZOOM_CONFIG.zoomMax, zoom),
      );
      const cropW = w / zoomFactor;
      const cropH = h / zoomFactor;
      const sx = (w - cropW) / 2;
      const sy = (h - cropH) / 2;
      ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, w, h);

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9),
      );
      if (!blob) throw new Error("Failed to capture frame");

      const tempId = `local-${Date.now()}`;
      const localUrl = URL.createObjectURL(blob);
      setThumbnails((prev) =>
        [{ id: tempId, url: localUrl }, ...prev].slice(0, 30),
      );

      const data = await uploadFrame(blob); // { id, thumbnail_url? }
      if (data?.thumbnail_url) {
        const resolved = resolveUrl(data.thumbnail_url);
        setThumbnails((prev) =>
          [
            { id: data.id || tempId, url: resolved },
            ...prev.filter((t) => t.id !== tempId),
          ].slice(0, 30),
        );
        const maxFrames = zoomConfig.maxFrames || DEFAULT_ZOOM_CONFIG.maxFrames;
        const nextCount =
          typeof data?.count === "number" ? data.count : frameCount + 1;
        setFrameCount(nextCount);
        if (nextCount >= 0.9 * maxFrames && nextCount < maxFrames) {
          setNotice(`Approaching max length: ${nextCount}/${maxFrames} frames`);
        }
      }
    } catch (e) {
      setError(e.message || "Capture failed");
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, frameCount, zoomConfig, shareOverlay, pendingResetConfirm]);

  // --- Undo last frame ---
  const handleUndo = useCallback(async () => {
    if (shareOverlay) return;
    bumpActivity();
    if (pendingResetConfirm) setPendingResetConfirm(false);
    setNotice("");
    setThumbnails((prev) => prev.slice(1));
    try {
      const res = await deleteLastFrame();
      if (res && typeof res.count === "number") {
        setFrameCount(res.count);
      } else {
        setFrameCount((c) => Math.max(0, c - 1));
      }
    } catch (err) {
      console.warn("undo failed", err);
    }
  }, [shareOverlay, pendingResetConfirm]);

  // --- Reset all ---
  const handleResetAll = useCallback(async () => {
    if (shareOverlay) {
      setShareOverlay(null);
      setPendingResetConfirm(false);
      setError("");
      setNotice("");
      return;
    }
    bumpActivity();
    if (!pendingResetConfirm) {
      setPendingResetConfirm(true);
      setNotice("Press done again to upload and start a new session.");
      setError("");
      return;
    }

    setPendingResetConfirm(false);
    setNotice("");
    setIsPlaying(false);
    setPlaybackSrc("");
    setAutoplayBlocked(false);
    setThumbnails([]);
    setFrameCount(0);
    try {
      const resp = await finalizeShare();
      const shareUrl = resp?.share?.url || resp?.url;
      if (!shareUrl) {
        setError("Share failed (no URL returned)");
      } else {
        setError("");
        setShareOverlay({
          url: resp?.share?.download_url || resp?.download_url || shareUrl,
          expiresAt: resp?.share?.expiresAt || resp?.expiresAt,
          key: resp?.share?.key || resp?.key,
        });
      }
    } catch (e) {
      console.warn("share on reset failed", e);
      setError(e.message || "Share failed");
    }
    try {
      await startFreshSession(); // clean up the closing session before rotating
    } catch (e) {
      console.warn("cleanup reset failed", e);
    }
    rotateSessionId();
    try {
      await startFreshSession();
      setFrameCount(0);
      setThumbnails([]);
    } catch (e) {
      setError(e.message || "Reset failed");
    }
  }, [pendingResetConfirm, shareOverlay]);

  // --- Build & play (no fullscreen API) ---
  const handlePlay = useCallback(async () => {
    if (shareOverlay) {
      setShareOverlay(null);
      setPendingResetConfirm(false);
      setError("");
      setNotice("");
      return;
    }
    bumpActivity();
    if (pendingResetConfirm) setPendingResetConfirm(false);
    setNotice("");
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
        const onMeta = () => {
          cleanup();
          resolve();
        };
        const onErr = () => {
          cleanup();
          reject(new Error("Video tag error"));
        };
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

  // --- WebSocket subscription to backend button events ---
  useEffect(() => {
    let cancelled = false;
    let ws;
    let pingTimer;

    function connect() {
      const BACKEND_ORIGIN =
        import.meta.env?.VITE_BACKEND_ORIGIN || window.location.origin;
      const wsUrl = BACKEND_ORIGIN.replace(/^http/, "ws") + "/ws";
      // record attempted URL even if connection fails
      setWsInfo((p) => ({ ...p, url: wsUrl }));
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (IS_DEV) console.log("[ws] open", wsUrl);
        setWsInfo((p) => ({ ...p, connected: true, url: wsUrl }));
        // Optional keepalive to keep proxies/load balancers happy
        pingTimer = setInterval(() => {
          try {
            ws.send("ping");
          } catch {}
        }, 25000);
      };

      ws.onmessage = (e) => {
        try {
          const raw = (e.data ?? "").toString();
          const trimmed = raw.trim().toLowerCase();
          const record = (t) => setWsInfo((p) => ({ ...p, last: t }));

          if (trimmed === "capture") {
            record("capture");
            return void handleCapture();
          }
          if (trimmed === "play") {
            record("play");
            return void handlePlay();
          }
          if (trimmed === "reset") {
            record("reset");
            return void handleResetAll();
          }
          if (trimmed === "undo") {
            record("undo");
            return void handleUndo();
          }

          const msg = JSON.parse(raw);
          const t = String(msg?.type || "").toLowerCase();
          record(t || "unknown");
          if (t === "capture") return void handleCapture();
          if (t === "play") return void handlePlay();
          if (t === "reset") return void handleResetAll();
          if (t === "undo") return void handleUndo();
          if (IS_DEV) console.log("[ws] ignored message", msg);
        } catch (err) {
          if (IS_DEV) console.warn("[ws] bad message", e.data);
          setWsInfo((p) => ({ ...p, last: "bad-message" }));
        }
      };

      ws.onclose = (evt) => {
        if (IS_DEV) console.log("[ws] close", evt?.code, evt?.reason);
        clearInterval(pingTimer);
        setWsInfo((p) => ({
          ...p,
          connected: false,
          last: `close:${evt?.code || 1006}`,
        }));
        if (!cancelled) setTimeout(connect, 2000); // simple reconnect
      };

      ws.onerror = (e) => {
        setWsInfo((p) => ({ ...p, last: "error" }));
        // noop; close handler will trigger reconnect
      };
    }

    connect();
    return () => {
      cancelled = true;
      clearInterval(pingTimer);
      try {
        ws && ws.close();
      } catch {}
    };
  }, [handleCapture, handlePlay, handleResetAll, handleUndo]);

  // --- Button forwarder status (dev helper) ---
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const status = await getForwarderStatus();
        if (!stopped) setSerialMissing(!(status?.alive && status?.connected));
      } catch {
        if (!stopped) setSerialMissing(true);
      }
    };
    check();
    const id = setInterval(check, 10000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  // Auto-clear notices after a delay (e.g., zoom adjustments)
  useEffect(() => {
    if (!notice) return;
    // Keep inactivity warning visible until reset/interaction
    if (notice.startsWith("Inactivity:")) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Clear warning when below threshold
  useEffect(() => {
    const maxFrames = zoomConfig.maxFrames || DEFAULT_ZOOM_CONFIG.maxFrames;
    if (
      frameCount < 0.9 * maxFrames &&
      notice?.startsWith("Approaching max length")
    ) {
      setNotice("");
    }
  }, [frameCount, zoomConfig, notice]);

  const resetForInactivity = useCallback(async () => {
    setShareOverlay(null);
    setPendingResetConfirm(false);
    setIsPlaying(false);
    setPlaybackSrc("");
    setAutoplayBlocked(false);
    setNotice("Session timed out — starting fresh");
    setNoticeBlink(false);
    setError("");
    try {
      await startFreshSession();
    } catch {}
    rotateSessionId();
    try {
      await startFreshSession();
      setThumbnails([]);
      setFrameCount(0);
    } catch {}
  }, [rotateSessionId, startFreshSession]);

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastActivity;
    const hasFrames = frameCount > 0 || thumbnails.length > 0;
    if (!hasFrames) {
      return;
    }

    const warnTimer = setTimeout(() => {
      setNotice("Inactivity: session will reset soon");
      setNoticeBlink(true);
    }, WARN_MS);

    const resetTimer = setTimeout(
      () => {
        resetForInactivity();
      },
      WARN_MS + (TIMEOUT_MS - WARN_MS),
    );

    return () => {
      clearTimeout(warnTimer);
      clearTimeout(resetTimer);
    };
  }, [
    lastActivity,
    resetForInactivity,
    frameCount,
    thumbnails.length,
    WARN_MS,
    TIMEOUT_MS,
  ]);

  // Global activity listeners (keys/mouse/touch)
  useEffect(() => {
    const onActivity = () => bumpActivity();
    window.addEventListener("keydown", onActivity);
    window.addEventListener("mousemove", onActivity);
    window.addEventListener("touchstart", onActivity);
    window.addEventListener("click", onActivity);
    return () => {
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("touchstart", onActivity);
      window.removeEventListener("click", onActivity);
    };
  }, [bumpActivity]);

  // --- Keyboard controls (dev & prod) ---
  useEffect(() => {
    const onKey = async (e) => {
      if (shareOverlay) {
        setShareOverlay(null);
        setPendingResetConfirm(false);
        setError("");
        return;
      }
      if (e.repeat) return;
      const k = e.key.toLowerCase();

      // Helpful defaults
      if (k === " " || k === "c") {
        // Space or C: capture
        e.preventDefault();
        await handleCapture();
        return;
      }
      if (k === "z" || k === "u") {
        // Z or U: undo
        e.preventDefault();
        await handleUndo();
        return;
      }
      if (k === "d") {
        // D: done/upload
        e.preventDefault();
        await handleResetAll();
        return;
      }
      if (k === "p" || k === "enter") {
        // P or Enter: play
        e.preventDefault();
        await handlePlay();
        return;
      }
      if (k === "arrowup") {
        e.preventDefault();
        const next = Math.min(
          zoomConfig.zoomMax || DEFAULT_ZOOM_CONFIG.zoomMax,
          zoom + (zoomConfig.zoomStep || DEFAULT_ZOOM_CONFIG.zoomStep),
        );
        setZoom(next);
        try {
          localStorage.setItem("gsm-zoom", String(next));
        } catch {}
        setNotice(`Zoom: ${next.toFixed(1)}x`);
        return;
      }
      if (k === "arrowdown") {
        e.preventDefault();
        const next = Math.max(
          zoomConfig.zoomMin || DEFAULT_ZOOM_CONFIG.zoomMin,
          zoom - (zoomConfig.zoomStep || DEFAULT_ZOOM_CONFIG.zoomStep),
        );
        setZoom(next);
        try {
          localStorage.setItem("gsm-zoom", String(next));
        } catch {}
        setNotice(`Zoom: ${next.toFixed(1)}x`);
        return;
      }
      if (k === "escape") {
        // Esc: stop playback
        if (isPlaying) {
          setIsPlaying(false);
          setPlaybackSrc("");
          setAutoplayBlocked(false);
        }
        return;
      }
      // toggle dev help with "?" (Shift+/) — dev only
      if (IS_DEV && (e.key === "?" || (k === "/" && e.shiftKey))) {
        setShowDevHelp((v) => !v);
      }
      if (IS_DEV && /^\d$/.test(k) && k !== "0") {
        const idx = parseInt(k, 10) - 1;
        if (cameras[idx]) {
          setActiveCamera(cameras[idx].deviceId);
          setNotice(
            `Switched camera to #${k}: ${cameras[idx].label || "Camera"}`,
          );
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    handleCapture,
    handleUndo,
    handleResetAll,
    handlePlay,
    isPlaying,
    shareOverlay,
    zoom,
    cameras,
  ]);

  return (
    <div className="relative h-screen w-screen bg-black overflow-hidden text-white select-none">
      {shareOverlay && (
        <div
          className="absolute inset-0 z-50 bg-black flex flex-col items-center justify-center gap-6 px-4 text-center"
          onClick={() => {
            setShareOverlay(null);
            setPendingResetConfirm(false);
            setError("");
          }}
        >
          <div className="space-y-2">
            <div className="text-3xl font-bold">Download your video</div>
            <div className="text-sm text-white/80">
              Scan the code to download. Press any button to continue.
            </div>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-2xl">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=900x900&data=${encodeURIComponent(shareOverlay.url)}`}
              alt="QR code for shared video"
              className="w-[80vw] max-w-[680px] max-h-[80vh] object-contain"
            />
          </div>
          <div className="text-xs text-white/70 break-all max-w-[90vw]">
            {shareOverlay.url}
          </div>
        </div>
      )}

      {/* Live camera background */}
      <video
        ref={videoRef}
        muted
        playsInline
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${isPlaying ? "opacity-0" : "opacity-100"}`}
        style={{
          transform: `scale(${Math.max(
            zoomConfig.zoomMin || DEFAULT_ZOOM_CONFIG.zoomMin,
            Math.min(zoomConfig.zoomMax || DEFAULT_ZOOM_CONFIG.zoomMax, zoom),
          )})`,
          transformOrigin: "center",
        }}
      />

      {/* Build mode UI (no on-screen buttons) */}
      {!isPlaying && (
        <>
          <div className="absolute top-4 left-4 bg-black/60 px-3 py-1 rounded-xl text-sm backdrop-blur">
            {streamReady ? "Live" : "Starting Camera..."}
          </div>
          {serialMissing && (
            <div className="absolute top-4 left-32 bg-amber-500/80 text-black px-3 py-1 rounded-xl text-sm shadow backdrop-blur">
              Serial disconnected
            </div>
          )}

          {/* Film roll in lower third */}
          <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/70 to-transparent p-4 flex items-end">
            <div className="flex overflow-x-auto gap-3 flex-1">
              {thumbnails.length === 0 && (
                <div className="text-white/80 text-sm">
                  No frames yet — press{" "}
                  <span className="font-semibold">Space</span> to capture.
                </div>
              )}
              {thumbnails.map((t) => (
                <img
                  key={t.id}
                  src={t.url}
                  alt=""
                  className="h-28 object-cover rounded-lg border-4 border-black shadow"
                />
              ))}
            </div>
          </div>
          {/* Dev helper overlay (visible only in dev builds) */}
          {import.meta.env.DEV && showDevHelp && (
            <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
              <div className="bg-black/70 text-white text-sm rounded-xl p-4 leading-6 shadow-lg backdrop-blur-md">
                <div className="font-semibold mb-1">Dev Controls</div>
                <div>
                  <span className="font-mono">Space</span> or{" "}
                  <span className="font-mono">C</span> — Capture
                </div>
                <div>
                  <span className="font-mono">Z</span> or{" "}
                  <span className="font-mono">U</span> — Undo last
                </div>
                <div>
                  <span className="font-mono">D</span> — Done (upload & new
                  session)
                </div>
                <div>
                  <span className="font-mono">P</span> or{" "}
                  <span className="font-mono">Enter</span> — Play
                </div>
                <div>
                  <span className="font-mono">↑</span> /{" "}
                  <span className="font-mono">↓</span> — Zoom in/out (persists
                  locally)
                </div>
                {cameras.length > 0 && (
                  <div>
                    <span className="font-mono">1-9</span> — Switch camera (dev
                    only)
                  </div>
                )}
                <div>
                  <span className="font-mono">Esc</span> — Stop playback
                </div>
                <div className="mt-1 opacity-80">
                  <span className="font-mono">?</span> to hide
                </div>
                {cameras.length > 0 && (
                  <div className="mt-1">
                    Cameras:
                    <div className="mt-1 space-y-1">
                      {cameras.map((c, i) => (
                        <div
                          key={c.deviceId || i}
                          className={`flex items-center gap-2 ${c.deviceId === activeCamera ? "text-emerald-300" : "text-white"}`}
                        >
                          <span className="font-mono">{i + 1}.</span>
                          <span className="truncate max-w-[220px]">
                            {c.label || `Camera ${i + 1}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* WS status badge (anchors under Dev Controls) */}
              <div
                className={`px-3 py-1.5 rounded-lg text-xs font-medium backdrop-blur shadow-lg ${wsInfo.connected ? "bg-emerald-500/80 text-black" : "bg-red-500/80 text-white"}`}
              >
                <div className="font-semibold">
                  WS {wsInfo.connected ? "Connected" : "Disconnected"}
                </div>
                <div className="opacity-90 max-w-[260px] truncate">
                  {wsInfo.url || "—"}
                </div>
                <div className="opacity-90">last: {wsInfo.last || "—"}</div>
              </div>
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
                  try {
                    await playbackRef.current?.play();
                    setAutoplayBlocked(false);
                  } catch {}
                }}
              >
                Tap to Play
              </button>
            </div>
          )}
        </div>
      )}

      {notice && !shareOverlay && (
        <div
          className={`absolute top-16 left-1/2 -translate-x-1/2 bg-amber-400 text-black px-6 py-3 rounded-2xl text-lg font-semibold shadow-xl ${noticeBlink ? "animate-pulse" : ""}`}
        >
          {notice}
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
