import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const BACKEND = "http://localhost:7878";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
      "/api/events": { target: BACKEND, changeOrigin: true, ws: false },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/monaco-editor") ||
            id.includes("node_modules/@monaco-editor")
          ) {
            return "monaco";
          }
          if (
            id.includes("node_modules/@react-three") ||
            id.includes("node_modules/three") ||
            id.includes("node_modules/three-stdlib") ||
            id.includes("node_modules/deepslate")
          ) {
            return "three";
          }
        },
      },
    },
  },
});
