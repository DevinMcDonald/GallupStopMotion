// src/lib/backend.js
// Proxy-friendly API base: leave VITE_API_BASE empty when using Vite proxy.
// If you want to bypass the proxy, set VITE_API_BASE to "http://localhost:8000".
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

// Resolve backend-relative paths to the correct origin.
// - With proxy (API_BASE = ""), keep them relative so Vite routes them.
// - Without proxy, prefix with API_BASE.
export const resolveUrl = (u) => {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;          // already absolute
  if (!API_BASE) return u.startsWith("/") ? u : `/${u}`; // proxy/same-origin
  const path = u.startsWith("/") ? u : `/${u}`;
  return `${API_BASE}${path}`;
};

// --- API calls ---

export async function uploadFrame(blob) {
  const form = new FormData();
  form.append("frame", blob, `${Date.now()}.jpg`);
  const res = await fetch(`${API_BASE || ""}/api/frames`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json(); // { id, thumbnail_url? }
}

export async function deleteLastFrame() {
  await fetch(`${API_BASE || ""}/api/frames/last`, { method: "DELETE" });
}

export async function buildVideo() {
  const res = await fetch(`${API_BASE || ""}/api/video`, { method: "POST" });
  if (!res.ok) throw new Error("Video build failed");
  return res.json(); // { video_url }
}
