import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { metaImagesPlugin } from "./vite-plugin-meta-images";

const appVersion = String(JSON.parse(readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8")).version || "").trim();

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    tailwindcss(),
    metaImagesPlugin(),
  ],

  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
  },

  esbuild: mode === "production" ? { pure: ["console.log", "console.debug", "console.info"] } : undefined,

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
    sourcemap: mode !== "production",
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // PERF-BUDGET-ARCH-01 — só metadata auxiliar (dist/public/.vite/manifest.json), não afeta chunking nem
    // o conteúdo/hash de nenhum asset gerado. Usado por scripts/performance/check-bundle-budgets.mjs para
    // distinguir eager (boot) de lazy (rota) via os imports/dynamicImports reais do entry, em vez de regex
    // frágil sobre nomes de arquivo.
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          const moduleId = id.replace(/\\/g, "/");

          if (!moduleId.includes("/node_modules/")) return undefined;

          const hasPackage = (packageName: string) => moduleId.includes(`/node_modules/${packageName}/`);

          if (hasPackage("react") || hasPackage("react-dom") || hasPackage("scheduler")) {
            return "vendor-react-core";
          }

          if (hasPackage("@firebase/firestore") || moduleId.includes("/node_modules/firebase/firestore")) {
            return "vendor-firebase-firestore";
          }

          if (hasPackage("@firebase/auth") || moduleId.includes("/node_modules/firebase/auth")) {
            return "vendor-firebase-auth";
          }

          if (hasPackage("@firebase/storage") || moduleId.includes("/node_modules/firebase/storage")) {
            return "vendor-firebase-storage";
          }

          if (
            hasPackage("@firebase/analytics") ||
            hasPackage("@firebase/performance") ||
            hasPackage("@firebase/remote-config") ||
            moduleId.includes("/node_modules/firebase/analytics") ||
            moduleId.includes("/node_modules/firebase/performance") ||
            moduleId.includes("/node_modules/firebase/remote-config")
          ) {
            return "vendor-firebase-observability";
          }

          if (moduleId.includes("/node_modules/@firebase/") || hasPackage("firebase")) {
            return "vendor-firebase-core";
          }

          if (hasPackage("recharts") || hasPackage("victory-vendor") || moduleId.includes("/node_modules/d3-")) {
            return "vendor-recharts";
          }

          if (hasPackage("@radix-ui")) {
            return "vendor-radix";
          }

          if (hasPackage("lucide-react")) {
            return "vendor-lucide";
          }

          if (hasPackage("date-fns")) {
            return "vendor-date-fns";
          }

          if (hasPackage("qrcode.react")) {
            return "vendor-qrcode";
          }

          if (hasPackage("framer-motion")) {
            return "vendor-motion";
          }

          if (hasPackage("zod") || hasPackage("zod-validation-error")) {
            return "vendor-validation";
          }

          if (hasPackage("react-hook-form") || hasPackage("@hookform/resolvers")) {
            return "vendor-forms";
          }

          if (hasPackage("@tanstack/react-query") || hasPackage("wouter")) {
            return "vendor-app-runtime";
          }

          if (hasPackage("@zxing/library")) {
            return "vendor-scanner";
          }

          if (
            hasPackage("class-variance-authority") ||
            hasPackage("clsx") ||
            hasPackage("tailwind-merge") ||
            hasPackage("embla-carousel-react") ||
            hasPackage("react-day-picker") ||
            hasPackage("cmdk") ||
            hasPackage("input-otp") ||
            hasPackage("next-themes") ||
            hasPackage("react-resizable-panels") ||
            hasPackage("sonner") ||
            hasPackage("vaul")
          ) {
            return "vendor-ui";
          }

          return "vendor-misc";
        },
      },
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
}));
