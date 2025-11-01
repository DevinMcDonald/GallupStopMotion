// src/lib/backend.js

// Leave VITE_API_BASE empty when using the Vite proxy. Set to your backend URL
// (e.g. http://localhost:8000) only if you are NOT using the proxy.
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

// Resolve a backend-relative path to an absolute/requestable URL.
// - With proxy (API_BASE=""), keep it relative so Vite forwards (/api, /frames, /videos).
// - Without proxy, prefix with API_BASE.
export const resolveUrl = (u) => {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (!API_BASE) return u.startsWith("/") ? u : `/${u}`;
  const path = u.startsWith("/") ? u : `/${u}`;
  return `${API_BASE}${path}`;
};

// --- Session management ---
// We use a simple per-page-load session id. Backends that support it can bucket
// frames by ?session=<id>. If your backend doesn’t implement sessions yet,
// the reset endpoints below simply delete all frames in the working folder.
export const sessionId = (() => {
  // New session per page load to satisfy "each session clears previous one"
  return Math.random().toString(36).slice(2);
})();

// Helper to build a URL for an endpoint with optional session query
const withSession = (path) => {
  const url = `${API_BASE || ""}${path}`;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}session=${encodeURIComponent(sessionId)}`;
};

// --- API calls ---

export async function uploadFrame(blob) {
  const form = new FormData();
  form.append("frame", blob, `${Date.now()}.jpg`);
  const res = await fetch(withSession("/api/frames"), { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json(); // { id, thumbnail_url? }
}

export async function deleteLastFrame() {
  await fetch(withSession("/api/frames/last"), { method: "DELETE" });
}

export async function buildVideo() {
  const res = await fetch(withSession("/api/video"), { method: "POST" });
  if (!res.ok) throw new Error("Video build failed");
  return res.json(); // { video_url }
}

// Clears all frames for this session (preferred) or global (fallback).
export async function resetAll() {
  // Preferred (session-aware) endpoint:
  let res = await fetch(withSession("/api/frames/all"), { method: "DELETE" });
  if (res.status === 404) {
    // Fallback: some backends might expose a global reset without session param
    res = await fetch(`${API_BASE || ""}/api/frames/all`, { method: "DELETE" });
  }
  if (!res.ok && res.status !== 404) {
    throw new Error(`Reset failed: ${res.status}`);
  }
}

// Called on app start to ensure a clean slate for each kiosk session
export async function startFreshSession() {
  try {
    await resetAll();
  } catch {
    // If the endpoint doesn’t exist yet, ignore for now (UI will still work)
  }
}
