import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@repomind/shared": path.resolve(__dirname, "./packages/shared/src/index.ts"),
      "@repomind/database": path.resolve(__dirname, "./packages/database/src/index.ts"),
      "@repomind/worker": path.resolve(__dirname, "./packages/worker/src/index.ts"),
      "@repomind/github": path.resolve(__dirname, "./packages/github/src/index.ts"),
      "@repomind/parser": path.resolve(__dirname, "./packages/parser/src/index.ts"),
      "@repomind/ingestion": path.resolve(__dirname, "./packages/ingestion/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 20000,
    globals: true,
  },
});
