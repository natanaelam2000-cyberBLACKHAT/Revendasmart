import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { metaImagesPlugin } from "./vite-plugin-meta-images";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  plugins: [
  react(),
  runtimeErrorOverlay(),
  tailwindcss(),
  metaImagesPlugin(),

  ...(process.env.SENTRY_AUTH_TOKEN
    ? [
        sentryVitePlugin({
          org: "revenda-smart",
          project: "javascript-react",
          authToken: process.env.SENTRY_AUTH_TOKEN,
        }),
      ]
    : []),
],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },

  css: {
    postcss: {
      plugins: [],
    },
  },

  root: path.resolve(import.meta.dirname, "client"),

 build: {
  sourcemap: true,
  outDir: path.resolve(import.meta.dirname, "dist/public"),
  emptyOutDir: true,

  rollupOptions: {
    plugins: [
      visualizer({
        open: true,
        filename: "dist/stats.html",
        gzipSize: true,
        brotliSize: true,
      }),
    ],
  },
},

  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});