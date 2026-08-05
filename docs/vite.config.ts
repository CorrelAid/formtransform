import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";

// GitHub Pages serves from /<repo>/, so set base accordingly via env.
// Locally: VITE_BASE=/ pnpm dev
const base = process.env.VITE_BASE || "/survey-type-registry/";

export default defineConfig({
  base,
  plugins: [svelte()],
  resolve: {
    alias: {
      "@registry": resolve(__dirname, ".."),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
