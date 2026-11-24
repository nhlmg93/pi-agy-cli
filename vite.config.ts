import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["coverage/**", "node_modules/**"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "typescript/no-explicit-any": "error",
      "typescript/no-unnecessary-type-assertion": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      {
        files: ["tests/**"],
        rules: { "typescript/no-explicit-any": "off" },
      },
    ],
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["coverage/**", "node_modules/**"],
  },
  test: {
    globals: true,
    setupFiles: ["tests/setup-env.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/account-models.ts",
        "src/agy-cli.ts",
        "src/cli-auth.ts",
        "src/cli-protocol.ts",
        "src/episode-mode.ts",
        "src/event-bridge.ts",
        "src/pi-context.ts",
        "src/provider-env.ts",
        "src/thinking-config.ts",
        "src/tool-mapping.ts",
      ],
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
    },
  },
  run: {
    cache: { scripts: false, tasks: true },
  },
});
