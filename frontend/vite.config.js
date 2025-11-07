// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      // HTTP API (no rewrite if your backend serves under /api)
      "/api": {
        target: "http://backend:8000",
        changeOrigin: true,
        ws: true, // enables WS when you hit /api/ws
      },

      // Dedicated WS path if you use /ws (optional)
      "/ws": {
        target: "ws://backend:8000",
        changeOrigin: true,
        ws: true,
      },

      // Static mounts served by FastAPI:
      "/frames": {
        target: "http://backend:8000",
        changeOrigin: true,
      },
      "/videos": {
        target: "http://backend:8000",
        changeOrigin: true,
      },
    },
  },
});
