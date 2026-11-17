#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { ENGINE_VERSION, parseBoard, BoardParseError } from "@patchbay/engine";

const args = process.argv.slice(2);
const [cmd, ...rest] = args;

function usage(): never {
  console.log(`patchbay v${ENGINE_VERSION}
Usage:
  patchbay board validate <file>   validate a board file
  patchbay --version`);
  process.exit(cmd === undefined ? 0 : 2);
}

if (cmd === "--version" || cmd === "version") {
  console.log(ENGINE_VERSION);
  process.exit(0);
}

if (cmd === "board" && rest[0] === "validate") {
  const file = rest[1];
  if (!file) {
    console.error("error: board validate requires a file path");
    process.exit(2);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`error: cannot read board file: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  try {
    const board = parseBoard(raw, file);
    console.log(`ok: "${board.name}" — ${board.tiles.length} tiles, ${board.wires.length} wires`);
    process.exit(0);
  } catch (e) {
    if (e instanceof BoardParseError) {
      console.error(`invalid: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

usage();
