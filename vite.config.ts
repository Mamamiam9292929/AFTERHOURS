import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
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

export default defineConfig({
  plugins: [react(), tailwindcss(), ogImagePlugin()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
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
