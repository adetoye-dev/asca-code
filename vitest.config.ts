import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the frontend. `tests/` is the Python suite, run by `npm test`.
    // Component tests opt into jsdom with a `@vitest-environment jsdom` docblock,
    // so the service tests stay on the cheaper node environment.
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
