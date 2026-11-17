export interface ModelRef { provider: string; model: string }

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string; // for role=tool
  toolCalls?: { id: string; name: string; args: unknown }[]; // for role=assistant
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: { name: string; description: string; parameters: unknown }[];
  apiKey?: string;
  baseUrl?: string;
}

export interface ChatResponse {
  text?: string;
  toolCalls: { id: string; name: string; args: unknown }[];
  usage?: { promptTokens: number; completionTokens: number };
}

/** Transport is injected so tests can record/fixture real request bytes. */
export type HttpTransport = (url: string, init: RequestInit) => Promise<{ status: number; text: string }>;

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}
