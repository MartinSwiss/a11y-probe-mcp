import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("./test/cloudflare-workers-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/workers/**/*.dev.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "test/workers/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
