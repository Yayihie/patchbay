import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cliJs = path.join(process.cwd(), "dist", "index.js");

function run(args: string[]): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync(process.execPath, [cliJs, ...args], { encoding: "utf8" }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

const goodBoard = {
  format: "patchbay.board", version: 1, name: "roundtrip",
  tiles: [{ id: "a", kind: "context", name: "C" }],
  wires: [],
};

describe("patchbay board validate", () => {
  it("accepts a valid hand-made board (M1 acceptance)", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pb-cli-")), "b.json");
    fs.writeFileSync(f, JSON.stringify(goodBoard));
    const r = run(["board", "validate", f]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("ok");
  });
  it("refuses an invalid board with a non-zero exit", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pb-cli-")), "b.json");
    fs.writeFileSync(f, JSON.stringify({ ...goodBoard, version: 99 }));
    const r = run(["board", "validate", f]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("invalid");
  });
});
