import { defineConfig } from "vitest/config";

// `test` runs the offline suite (unit + fixture parsing).
// `test:smoke` passes `--mode smoke`, which swaps in the live suite that hits
// the real my.schedulemaster.com using SM_TEST_USERNAME / SM_TEST_PASSWORD.
export default defineConfig(({ mode }) => ({
  test: {
    include:
      mode === "smoke" ? ["test/**/*.live.test.ts"] : ["test/**/*.test.ts"],
    exclude: mode === "smoke" ? [] : ["test/**/*.live.test.ts"],
  },
}));
