import type { ChatRequest, ChatResponse, HttpTransport } from "./types.js";
import { ProviderError } from "./types.js";

const ANTHROPIC_BASE = "https://api.anthropic.com/v1";

/** Anthropic Messages API with tool use. */
export async function chatAnthropic(req: ChatRequest, transport: HttpTransport): Promise<ChatResponse> {
  const base = (req.baseUrl ?? ANTHROPIC_BASE).replace(/\/$/, "");
  const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const messages = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool") {
        return { role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }] };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "assistant",
          content: [
            ...(m.content ? [{ type: "text", text: m.content }] : []),
            ...m.toolCalls.map((tc) => ({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args ?? {} })),
          ],
        };
      }
      return { role: m.role, content: m.content };
    });
  const body: Record<string, unknown> = { model: req.model, max_tokens: 4096, messages };
  if (system) body.system = system;
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      name: t.name, description: t.description, input_schema: t.parameters,
    }));
  }
  const res = await transport(base + "/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": req.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (res.status >= 400) throw new ProviderError(`anthropic returned ${res.status}: ${res.text.slice(0, 300)}`, res.status);
  const parsed = JSON.parse(res.text) as {
    content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (parsed.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  const toolCalls = (parsed.content ?? [])
    .filter((c) => c.type === "tool_use")
    .map((c) => ({ id: c.id ?? "", name: c.name ?? "", args: c.input }));
  return {
    text: text || undefined,
    toolCalls,
    usage: parsed.usage
      ? { promptTokens: parsed.usage.input_tokens ?? 0, completionTokens: parsed.usage.output_tokens ?? 0 }
      : undefined,
  };
}
