// src/lib/backend.js

// Leave VITE_API_BASE empty when using the Vite proxy. Set to your backend URL
// (e.g. http://localhost:8000) only if you are NOT using the proxy.
export const getApiBase = () =>
  (
    import.meta.env?.VITE_API_BASE ??
    (typeof process !== "undefined" ? process.env?.VITE_API_BASE : "") ??
    ""
  ).replace(/\/$/, "");

export const resolveUrlWithBase = (u, base) => {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (!base) return u.startsWith("/") ? u : `/${u}`;
  const path = u.startsWith("/") ? u : `/${u}`;
  return `${base}${path}`;
};

// Resolve a backend-relative path to an absolute/requestable URL.
// - With proxy (API_BASE=""), keep it relative so Vite forwards (/api, /frames, /videos).
// - Without proxy, prefix with API_BASE.
export const resolveUrl = (u) => {
  const base = getApiBase();
  return resolveUrlWithBase(u, base);
};

// --- Session management ---
const SESSION_STORAGE_KEY = "gsm-active-session";
const makeSessionId = () => Math.random().toString(36).slice(2);

let sessionId = makeSessionId();
let previousSessionId = null;

if (typeof window !== "undefined") {
  try {
    previousSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    previousSessionId = null;
  }
  sessionId = makeSessionId();
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  } catch {}
}

export const getSessionId = () => sessionId;
export const getPreviousSessionId = () => previousSessionId;

export function rotateSessionId() {
  previousSessionId = sessionId;
  sessionId = makeSessionId();
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  } catch {}
  return sessionId;
}

// Helper to build a URL for an endpoint with optional session query
const withSession = (path, sid = sessionId) => {
  const base = getApiBase();
  const url = `${base || ""}${path}`;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}session=${encodeURIComponent(sid)}`;
};

// --- API calls ---

export async function uploadFrame(blob, sid = sessionId) {
  const form = new FormData();
  form.append("frame", blob, `${Date.now()}.jpg`);
  const res = await fetch(withSession("/api/frames", sid), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Upload failed: ${res.status}`);
  }
  return res.json(); // { id, thumbnail_url? }
}

export async function deleteLastFrame(sid = sessionId) {
  const res = await fetch(withSession("/api/frames/last", sid), {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Undo failed: ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function buildVideo(sid = sessionId) {
  const res = await fetch(withSession("/api/video", sid), { method: "POST" });
  if (!res.ok) throw new Error("Video build failed");
  return res.json(); // { video_url }
}

// Clears all frames for this session (preferred) or global (fallback).
export async function resetAll(targetSessionId = sessionId) {
  // Preferred (session-aware) endpoint:
  let res = await fetch(withSession("/api/frames/all", targetSessionId), {
    method: "DELETE",
  });
  if (res.status === 404) {
    // Fallback: some backends might expose a global reset without session param
    const base = getApiBase();
    res = await fetch(`${base || ""}/api/frames/all`, { method: "DELETE" });
  }
  if (!res.ok && res.status !== 404) {
    throw new Error(`Reset failed: ${res.status}`);
  }
}

// Called on app start to ensure a clean slate for each kiosk session
export async function startFreshSession(targetSessionId = sessionId) {
  try {
    await resetAll(targetSessionId);
  } catch {
    // If the endpoint doesn’t exist yet, ignore for now (UI will still work)
  }
}

// Build + upload the current (or provided) session to R2.
export async function finalizeShare(targetSessionId = sessionId) {
  const res = await fetch(withSession("/api/session/share", targetSessionId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
  });
  if (import.meta.env.DEV) {
    console.log("[share] finalize", targetSessionId, res.status);
  }
  if (!res.ok) throw new Error(`Share failed: ${res.status}`);
  return res.json();
}

// Fire-and-forget share for unload/navigation. Falls back to fetch keepalive when needed.
export function finalizeShareBeacon(targetSessionId = sessionId) {
  const payload = JSON.stringify({ reason: "unload", ts: Date.now() });
  const url = withSession("/api/session/share", targetSessionId);

  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      return navigator.sendBeacon(
        url,
        new Blob([payload], { type: "application/json" }),
      );
    } catch {
      // fall through to fetch
    }
  }

  try {
    fetch(url, {
      method: "POST",
      body: payload,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
  return false;
}

export async function getForwarderStatus() {
  const res = await fetch(resolveUrl("/api/forwarder/status"));
  if (!res.ok) throw new Error(`Forwarder status failed: ${res.status}`);
  return res.json(); // { connected, alive, age_s, device, mode }
}
