/// <reference types="vitest/config" />
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tool version stamped into the app at build time: package.json semver plus a
// git description (see docs/web-ux.md -- a bench printout must be traceable to
// a code version). Falls back to "dev" outside a git checkout.
//
// git describe rather than a bare hash, because the bundle is built on a
// branch and merged by squash: the commit it was built from does not survive
// the merge, so a printout would cite a SHA that is not in the repository. A
// tag does survive. At a release this reads "v0.9.0"; between releases,
// "v0.9.0-3-gabc1234" -- the last release, the distance from it, and the
// commit; and a dirty tree says so.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };
function gitDescription(): string {
  // TAMAGO_GIT_HASH lets CI rebuild with the value stamped into a committed
  // bundle, making the prebuilts drift check byte-exact. Do not set it by hand:
  // a local build that pins the recorded value freezes the stamp, and the drift
  // check cannot notice because it compares that rebuild against itself.
  const pinned = process.env.TAMAGO_GIT_HASH;
  if (pinned) {
    return pinned;
  }
  try {
    // --always keeps this working before the first tag, or in a shallow clone
    // with no tags fetched, by falling back to the short hash.
    return execFileSync("git", ["describe", "--tags", "--always", "--dirty"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}
const hash = gitDescription();

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
