import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: {
      // Pin the "browser" zone, deliberately *not* the HAOS box's
      // America/New_York — the timestamp handling has to survive the two
      // disagreeing, and a suite running in ET would never exercise that.
      TZ: "America/Los_Angeles",
    },
  },
});
