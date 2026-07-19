import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/.git/**", "**/.next/**", "**/.turbo/**", "**/dist/**", "**/node_modules/**"]
  }
});
