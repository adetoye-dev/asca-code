import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the frontend. `tests/` is the Python suite, run by `npm test`.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
