import type { ChatRequest, ChatResponse, HttpTransport, ModelRef } from "./types.js";
import { chatOpenAI } from "./openai.js";
import { chatAnthropic } from "./anthropic.js";
import { chatGoogle } from "./google.js";
import { ProviderError } from "./types.js";

export type { ChatRequest, ChatResponse, ChatMessage, ModelRef, HttpTransport } from "./types.js";
export { ProviderError } from "./types.js";
export { chatOpenAI, OPENAI_DEFAULT_BASE } from "./openai.js";
export { chatAnthropic } from "./anthropic.js";
export { chatGoogle } from "./google.js";

/**
 * Route one chat call to the right provider. `openai-compatible` is the
 * escape hatch for vLLM / LM Studio / private gateways — base URL required.
 */
export async function chat(ref: ModelRef, req: Omit<ChatRequest, "model">, transport: HttpTransport): Promise<ChatResponse> {
  const full: ChatRequest = { ...req, model: ref.model };
  switch (ref.provider) {
    case "openai":
    case "openrouter":
    case "xai":
    case "ollama":
    case "openai-compatible":
      return chatOpenAI(full, ref.provider, transport);
    case "anthropic":
      return chatAnthropic(full, transport);
    case "google":
      return chatGoogle(full, transport);
    default:
      throw new ProviderError(`unknown provider "${ref.provider}"`);
  }
}
