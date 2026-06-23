import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: "postgresql://postgres:postgrespassword@127.0.0.1:5432/frontline_test",
      TEST_DATABASE_URL: "postgresql://postgres:postgrespassword@127.0.0.1:5432/frontline_test",
      REDIS_URL: "redis://127.0.0.1:6379"
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "packages/core/src/**",
        "apps/api/src/services/**"
      ],
      exclude: [
        "node_modules/**",
        "dist/**",
        "**/*.test.ts",
        "**/*.test.js",
        "apps/api/src/server.ts",
        "apps/api/src/index.ts",
        "apps/api/src/prisma.ts",
        "apps/api/src/routes/messages.route.ts"
      ],
      thresholds: {
        lines: 80,
        "packages/core/src/**": {
          lines: 100,
          functions: 100,
        },
        "apps/api/src/services/**": {
          lines: 90,
          functions: 90,
        }
      }
    }
  }
});
