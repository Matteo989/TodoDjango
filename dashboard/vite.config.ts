import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Le dashboard est compilé dans le dossier wwwroot du serveur .NET, qui le sert directement.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../src/MNBot.Api/wwwroot",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:5080",
      "/ws": { target: "ws://127.0.0.1:5080", ws: true },
    },
  },
});
