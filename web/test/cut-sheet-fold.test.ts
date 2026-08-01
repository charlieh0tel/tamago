// The cut sheet is read in a fixed-width pane, so it folds to 68 columns
// rather than needing a horizontal scrollbar. Folding is shared by both engines
// and byte-compared through the goldens; this covers the fold's own edges.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SHEETS = [
  "line_radials_circle_rhcp_2m",
  "balun4_radials_squircle_rhcp_70cm",
  "choke_radials_squircle_rhcp_70cm",
];

function sheet(name: string): string[] {
  return readFileSync(
    new URL(`../goldens/${name}.cutsheet.txt`, import.meta.url),
    "utf8",
  ).split("\n");
}

describe("cut sheet folding", () => {
  it("keeps every row inside the fold width", () => {
    for (const name of SHEETS) {
      for (const line of sheet(name)) {
        expect(line.length, `${name}: ${line}`).toBeLessThanOrEqual(68);
      }
    }
  });

  it("indents a continuation under the value it belongs to", () => {
    // The choke's harness description is the widest row in the set, so it folds.
    const lines = sheet("choke_radials_squircle_rhcp_70cm");
    const i = lines.findIndex((l) => l.startsWith("Choke "));
    expect(i).toBeGreaterThan(-1);
    const label = lines[i] as string;
    const cont = lines[i + 1] as string;
    expect(label).toMatch(/^Choke +: \S/);
    // Continuation is blank up to the column the value starts in, and no further.
    const valueCol = label.indexOf(": ") + 2;
    expect(cont.slice(0, valueCol)).toBe(" ".repeat(valueCol));
    expect(cont[valueCol]).not.toBe(" ");
  });

  it("never leaves a single word alone on a folded row", () => {
    for (const name of SHEETS) {
      const lines = sheet(name);
      lines.forEach((line, i) => {
        const prev = lines[i - 1];
        const isContinuation =
          i > 0 && /^ +\S/.test(line) && !line.includes(": ") && prev !== undefined;
        if (isContinuation && prev.length > 40) {
          expect(line.trim().includes(" "), `${name}: widow ${line.trim()}`).toBe(true);
        }
      });
    }
  });
});
