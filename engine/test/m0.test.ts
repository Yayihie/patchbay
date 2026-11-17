import { describe, it, expect } from "vitest";
import { parseBoard, BoardParseError } from "../src/board/parse.js";
import { ENGINE_VERSION } from "../src/version.js";

describe("M0", () => {
  it("reports a version", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("board parse (M1 groundwork)", () => {
  const good = {
    format: "patchbay.board", version: 1, name: "t",
    tiles: [{ id: "a", kind: "agent", name: "A" }],
    wires: [],
  };
  it("accepts a valid minimal board", () => {
    expect(parseBoard(good).name).toBe("t");
  });
  it("refuses an unknown tile kind with a useful error", () => {
    const bad = { ...good, tiles: [{ id: "x", kind: "widget", name: "X" }] };
    expect(() => parseBoard(bad)).toThrow(/unknown tile kind "widget"/);
  });
  it("refuses a wire to a nonexistent tile", () => {
    const bad = { ...good, wires: [{ id: "w1", kind: "data", from: "a", to: "ghost" }] };
    expect(() => parseBoard(bad)).toThrow(BoardParseError);
  });
  it("refuses a permission wire without a grant", () => {
    const bad = { ...good, wires: [{ id: "w2", kind: "permission", from: "a", to: "a" }] };
    expect(() => parseBoard(bad)).toThrow(/requires a "grant"/);
  });
});
