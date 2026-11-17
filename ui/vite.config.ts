import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: "",
  build: {
    outDir: "dist",
    lib: {
      entry: "src/main.ts",
      name: "PatchbayUI",
      formats: ["es"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
