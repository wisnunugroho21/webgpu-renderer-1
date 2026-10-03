import { defineConfig } from "vite";
export default defineConfig({
  optimizeDeps: { include: ["@gltf-transform/core"] },
});
