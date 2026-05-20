import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tauri expects a fixed port and bypasses HMR over its own IPC.
// See https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  // Tauri 2 serves the bundled frontend at the webview root, so absolute
  // paths work — and we need `/` so wouter's base (derived from
  // import.meta.env.BASE_URL) is empty, not ".".
  base: "/",
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
    // Tauri reads from `../dist` (see src-tauri/tauri.conf.json frontendDist).
    outDir: "dist",
    emptyOutDir: true,
  },
});
