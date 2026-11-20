import { defineConfig } from "vite";

export default defineConfig({
  // Keep the build self-contained and portable (works on Firebase Hosting,
  // Netlify, Vercel, or any static host).
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
});
