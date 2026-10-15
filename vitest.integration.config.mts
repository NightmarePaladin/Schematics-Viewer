import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests talk to a real Supabase project (see TESTING.md). They skip themselves when credentials are absent.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
