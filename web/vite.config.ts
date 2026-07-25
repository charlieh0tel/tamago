/// <reference types="vitest/config" />
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tool version stamped into the app at build time: package.json semver plus the
// short git hash (see docs/web-ux.md -- a bench printout must be traceable to a
// code version). The hash falls back to "dev" outside a git checkout.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };
function gitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

// The production bundle is published into the GitHub Pages prebuilts tree.
// emptyOutDir is intentional: the app owns that directory at release time.
export default defineConfig({
  plugins: [react()],
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_HASH__: JSON.stringify(gitHash()),
  },
  worker: {
    format: "es",
  },
  server: {
    // The wasm nec2c runner lives in ../prebuilts (outside the web root); allow
    // the repo root so the worker can fetch nec2c.wasm in dev.
    fs: { allow: [".."] },
  },
  build: {
    outDir: "../prebuilts/app",
    emptyOutDir: true,
    target: "es2022",
  },
  test: {
    // Engine suites run under plain Node; UI suites opt into jsdom per-file via
    // a `// @vitest-environment jsdom` pragma.
    environment: "node",
    globals: true,
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ui.ts"],
  },
});
