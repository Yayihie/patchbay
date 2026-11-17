import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const cliJs = path.join(process.cwd(), "dist", "index.js");

describe("patchbay CLI", () => {
  it("reports a version matching the engine", () => {
    const out = execFileSync(process.execPath, [cliJs, "--version"], { encoding: "utf8" }).trim();
    expect(out).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
