import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface PluginManifest {
  name: string;
  version: string;
  transport: "stdio" | "http";
  command?: string[];
  url?: string;
  description?: string;
  scopes?: string[];
  risk: { default: "read" | "write" | "irreversible"; overrides?: Record<string, "read" | "write" | "irreversible"> };
  secrets?: Record<string, { title: string; vaultKey: string }>;
  integrity?: { pinVersions?: boolean };
}

export interface PluginTool {
  name: string;
  description: string;
  risk: "read" | "write" | "irreversible";
  source: "manifest" | "mcp";
}

/** Load a plugin manifest from a local file path or raw URL. */
export async function loadManifest(ref: string): Promise<PluginManifest | undefined> {
  let text: string;
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    const res = await fetch(ref);
    if (!res.ok) return undefined;
    text = await res.text();
  } else {
    if (!fs.existsSync(ref)) return undefined;
    text = fs.readFileSync(ref, "utf8");
  }
  return JSON.parse(text) as PluginManifest;
}

/** Compute the integrity hash of a stdio plugin's command + args.
 * If the hash changes between runs, the engine refuses (SPEC §6.4). */
export function integrityHash(command: string[]): string {
  return "sha256:" + crypto.createHash("sha256").update(command.join("\u0000")).digest("hex");
}

/** Resolve the risk class for an MCP tool name from the manifest.
 * Defaults to `irreversible` (safe by default, SPEC §6.3). */
export function toolRisk(toolName: string, manifest: PluginManifest | undefined): "read" | "write" | "irreversible" {
  if (!manifest) return "irreversible";
  return manifest.risk.overrides?.[toolName] ?? manifest.risk.default;
}

/** Build plugin source_json for storage from a manifest + resolved tools. */
export function pluginSource(manifest: PluginManifest | undefined, tools: PluginTool[]): string {
  return JSON.stringify({
    manifest,
    tools: tools.map((t) => ({ name: t.name, risk: t.risk })),
    importedAt: new Date().toISOString(),
  });
}
