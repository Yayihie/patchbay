import type { ChatRequest, ChatResponse, HttpTransport } from "./types.js";
import { ProviderError } from "./types.js";

const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Google Generative Language API (function calling). */
export async function chatGoogle(req: ChatRequest, transport: HttpTransport): Promise<ChatResponse> {
  const url = `${(req.baseUrl ?? GOOGLE_BASE).replace(/\/$/, "")}/models/${req.model}:generateContent?key=${req.apiKey ?? ""}`;
  const contents = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool") {
        return {
          role: "user",
          parts: [{ functionResponse: { name: (m as { toolName?: string }).toolName ?? m.toolCallId ?? "tool", response: { result: m.content } } }],
        };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        return { role: "model", parts: m.toolCalls.map((tc) => ({ functionCall: { name: tc.name, args: tc.args ?? {} } })) };
      }
      return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
    });
  const body: Record<string, unknown> = { contents };
  if (req.tools?.length) {
    body.tools = [{
      functionDeclarations: req.tools.map((t) => ({
        name: t.name, description: t.description, parameters: t.parameters,
      })),
    }];
  }
  const res = await transport(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status >= 400) throw new ProviderError(`google returned ${res.status}: ${res.text.slice(0, 300)}`, res.status);
  const parsed = JSON.parse(res.text) as {
    candidates?: { content?: { parts?: { text?: string; functionCall?: { name: string; args?: unknown } }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const parts = parsed.candidates?.[0]?.content?.parts ?? [];
  return {
    text: parts.map((p) => p.text).filter(Boolean).join("") || undefined,
    toolCalls: parts.filter((p) => p.functionCall).map((p) => ({
      id: crypto.randomUUID(), name: p.functionCall!.name, args: p.functionCall!.args ?? {},
    })),
    usage: parsed.usageMetadata
      ? { promptTokens: parsed.usageMetadata.promptTokenCount ?? 0, completionTokens: parsed.usageMetadata.candidatesTokenCount ?? 0 }
      : undefined,
  };
}
