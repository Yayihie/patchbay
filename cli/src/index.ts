#!/usr/bin/env node
import { ENGINE_VERSION } from "@patchbay/engine";

const args = process.argv.slice(2);
if (args[0] === "--version" || args[0] === "version") {
  console.log(ENGINE_VERSION);
  process.exit(0);
}
console.log("patchbay: commands land in M1 (run | board validate | plugin). See SPEC.md §16.");
