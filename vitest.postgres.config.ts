import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/postgres/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    maxWorkers: 1,
    fileParallelism: false,
  },
});
