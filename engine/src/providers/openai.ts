import type { ChatRequest, ChatResponse, HttpTransport } from "./types.js";
import { ProviderError } from "./types.js";

/**
 * Chat Completions wire format. Serves: openai, openrouter, xai,
 * openai-compatible (user-supplied base URL), and ollama (/v1).
 */
export const OPENAI_DEFAULT_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  xai: "https://api.x.ai/v1",
  ollama: "http://localhost:11434/v1",
};

export async function chatOpenAI(req: ChatRequest, provider: string, transport: HttpTransport): Promise<ChatResponse> {
  const base = req.baseUrl ?? OPENAI_DEFAULT_BASE[provider];
  if (!base) throw new ProviderError(`no base URL for provider "${provider}"`);
  const url = `${base.replace(/\/$/, "")}/chat/completions`;
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages.map((m) => {
      if (m.role === "tool") {
        return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "assistant", content: m.content ?? null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id, type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
          })),
        };
      }
      return { role: m.role, content: m.content };
    }),
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  const res = await transport(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(req.apiKey ? { authorization: `Bearer ${req.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (res.status >= 400) throw new ProviderError(`provider ${provider} returned ${res.status}: ${res.text.slice(0, 300)}`, res.status);
  const parsed = JSON.parse(res.text) as {
    choices?: { message?: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const msg = parsed.choices?.[0]?.message;
  return {
    text: msg?.content ?? undefined,
    toolCalls: (msg?.tool_calls ?? []).map((tc) => ({
      id: tc.id, name: tc.function.name, args: safeJson(tc.function.arguments),
    })),
    usage: parsed.usage
      ? { promptTokens: parsed.usage.prompt_tokens ?? 0, completionTokens: parsed.usage.completion_tokens ?? 0 }
      : undefined,
  };
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
