import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build as viteBuild, defineConfig, type Plugin } from "vite";
import { absoluteOgImages } from "./scripts/og-image.mjs";

/** W6 · og:image in index.html absolut machen, sobald VITE_SITE_URL beim Build gesetzt ist. */
function ogImagePlugin(): Plugin {
  let site: string | undefined;
  return {
    name: "afterhours-og-image",
    configResolved(config) {
      site = config.env.VITE_SITE_URL as string | undefined;
    },
    transformIndexHtml(html) {
      return absoluteOgImages(html, site);
    },
  };
}

const SRC = fileURLToPath(new URL("./src", import.meta.url));

/**
 * P4 · Texte für Push-Mitteilungen: `src/push/render.ts` als eigenes Skript `push-texts.js` (IIFE) neben
 * den Build legen. Der Service Worker (`public/sw.js`) lädt es per `importScripts` – Module kann er nicht
 * überall. Der zweite Build hat keine Konfigurationsdatei, ruft dieses Plugin also nicht erneut auf.
 */
function pushTextsPlugin(): Plugin {
  let root = process.cwd();
  let outDir = "dist";
  return {
    name: "afterhours-push-texts",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    async closeBundle() {
      await viteBuild({
        configFile: false,
        root,
        logLevel: "warn",
        resolve: { alias: { "@": SRC } },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          target: "es2020",
          lib: { entry: `${SRC}/push/render.ts`, name: "AfterhoursPush", formats: ["iife"], fileName: () => "push-texts.js" },
        },
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ogImagePlugin(), pushTextsPlugin()],
  resolve: {
    alias: { "@": SRC },
  },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        // Bibliotheken in eigene Chunks: Sie ändern sich selten und bleiben nach einem Update im Browser-Cache.
        manualChunks: {
          react: ["react", "react-dom", "react-dom/client", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
});
