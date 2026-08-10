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
  // TAMAGO_GIT_HASH lets CI rebuild with the hash stamped into a committed
  // bundle, making the prebuilts drift check byte-exact.
  const pinned = process.env.TAMAGO_GIT_HASH;
  if (pinned) {
    return pinned;
  }
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}
const hash = gitHash();

// The production bundle is published into the GitHub Pages prebuilts tree.
// emptyOutDir is intentional: the app owns that directory at release time.
export default defineConfig({
  plugins: [
    react(),
    {
      // version.json records the stamped hash so CI can reproduce the bundle.
      name: "stamp-version",
      apply: "build",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: `${JSON.stringify({ version: pkg.version, hash })}\n`,
        });
      },
    },
  ],
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_HASH__: JSON.stringify(hash),
  },
  worker: {
    format: "es",
  },
  server: {
    // The build writes into ../prebuilts/app, outside the web root; allow the
    // repo root so dev can serve from there too.
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
