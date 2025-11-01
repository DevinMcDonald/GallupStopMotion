// src/lib/backend.js
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:8000").replace(/\/$/, "");

export const resolveUrl = (u) => {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  const path = u.startsWith("/") ? u : `/${u}`;
  return `${API_BASE}${path}`;
};

export async function uploadFrame(blob) {
  const form = new FormData();
  form.append("frame", blob, `${Date.now()}.jpg`);
  const res = await fetch(`${API_BASE}/api/frames`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json(); // { id, thumbnail_url? }
}

export async function deleteLastFrame() {
  await fetch(`${API_BASE}/api/frames/last`, { method: "DELETE" });
}

export async function buildVideo() {
  const res = await fetch(`${API_BASE}/api/video`, { method: "POST" });
  if (!res.ok) throw new Error("Video build failed");
  return res.json(); // { video_url }
}
