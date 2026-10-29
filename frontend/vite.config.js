import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// dev: npm run dev → http://127.0.0.1:5173，API 代理到 FastAPI :8688
// build: 产物输出 dist/，由 FastAPI 托管
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8688", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
