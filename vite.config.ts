import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { realFilesystemPlugin } from "./vite-fs-bridge";

// https://vitejs.dev/config/
export default defineConfig(async ({ command }) => ({
  plugins: [react(), ...(command === "serve" ? [realFilesystemPlugin()] : [])],

  // Vite options tailored for development and Tauri desktop integration
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/.tauri/**", "**/core-engine/**", "**/projects/**"],
    },
  },
}));
