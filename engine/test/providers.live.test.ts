import { describe, it, expect } from "vitest";
import { chat } from "../src/providers/index.js";
import type { ChatMessage, HttpTransport, ModelRef } from "../src/providers/types.js";

const transport: HttpTransport = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status, text: await res.text() };
};

const system: ChatMessage = { role: "system", content: "Reply with exactly the word PONG and nothing else." };
const user: ChatMessage = { role: "user", content: "Say PONG." };

/** Opt-in: only runs when PATCHBAY_LIVE_TESTS=1 AND a provider key is set.
 *  These hit real providers and cost money; `npm test` skips them without keys. */
const live = (key?: string) => process.env.PATCHBAY_LIVE_TESTS === "1" && Boolean(key);

describe("provider integration (live)", () => {
  it.skipIf(!live(process.env.OPENAI_API_KEY))("openai returns text", async () => {
    const res = await chat(
      { provider: "openai", model: "gpt-4o-mini" },
      { messages: [system, user], apiKey: process.env.OPENAI_API_KEY },
      transport,
    );
    const text = res.text;
    expect(text).toBeDefined();
    expect(text!.length).toBeGreaterThan(0);
  });

  it.skipIf(!live(process.env.ANTHROPIC_API_KEY))("anthropic returns text", async () => {
    const res = await chat(
      { provider: "anthropic", model: "claude-3-haiku-20240307" },
      { messages: [system, user], apiKey: process.env.ANTHROPIC_API_KEY },
      transport,
    );
    const text = res.text;
    expect(text).toBeDefined();
    expect(text!.length).toBeGreaterThan(0);
  });

  it.skipIf(!live(process.env.GOOGLE_API_KEY))("google returns text", async () => {
    const res = await chat(
      { provider: "google", model: "gemini-1.5-flash" },
      { messages: [system, user], apiKey: process.env.GOOGLE_API_KEY },
      transport,
    );
    const text = res.text;
    expect(text).toBeDefined();
    expect(text!.length).toBeGreaterThan(0);
  });

  it("openai-compatible requires a user-supplied base URL", async () => {
    await expect(
      chat(
        { provider: "openai-compatible", model: "local" },
        { messages: [system, user] },
        transport,
      ),
    ).rejects.toThrow(/no base URL/);
  });
});
