import type { Tile } from "../board/types.js";
import crypto from "node:crypto";

export interface ApprovalArgs {
  runId: string;
  tileId: string;
  tileName: string;
  reason: string;
  args: unknown;
  auto?: boolean;
}

export interface NotifyTransport {
  desktop(a: ApprovalArgs): Promise<void>;
  webhook(a: ApprovalArgs & { url: string }): Promise<void>;
  email(a: ApprovalArgs & { to: string }): Promise<void>;
}

/** Default desktop transport: surface the gate in the local console. Runs
 * headless (no browser), so this is the v1 "human-present" channel. */
export class ConsoleDesktopTransport implements NotifyTransport {
  async desktop(a: ApprovalArgs): Promise<void> {
    console.log(
      `[patchbay:approval] run=${a.runId} tile=${a.tileName} (${a.tileId})\n` +
      `  reason: ${a.reason}\n` +
      `  pending args: ${JSON.stringify(a.args)}\n` +
      `  resume: POST /runs/${a.runId}/approve  { "decision": "approve" | "reject" }`);
  }
  async webhook(_a: ApprovalArgs & { url: string }): Promise<void> {
    // no-op: webhook only fires when explicitly configured
  }
  async email(_a: ApprovalArgs & { to: string }): Promise<void> {
    throw new Error("no SMTP relay configured: approvals cannot be sent by email until PATCHBAY_SMTP_HOST is set");
  }
}

/** Webhook transport per spec §7: one-click approve/deny link signed with
 * HMAC-SHA256 over "unix.rawbody" (timestamp + raw JSON body). Tampering
 * invalidates the signature and the gate rejects the decision. */
export class WebhookTransport implements NotifyTransport {
  constructor(private readonly secret: string) {}
  private sign(body: string): string {
    return crypto.createHmac("sha256", this.secret).update(body).digest("hex");
  }
  async desktop(a: ApprovalArgs): Promise<void> {
    // desktop handled by ConsoleDesktopTransport; webhook only fires on its channel
  }
  async webhook(a: ApprovalArgs & { url: string }): Promise<void> {
    const ts = Math.floor(Date.now() / 1000);
    const payload = { decision_token: `${a.runId}:${a.tileId}:${ts}` };
    const raw = JSON.stringify(payload);
    const sig = this.sign(`${ts}.${raw}`);
    const headers = {
      "Content-Type": "application/json",
      "X-Patchbay-Timestamp": String(ts),
      "X-Patchbay-Signature": `t=${ts},v1=${sig}`,
    };
    await fetch(a.url, { method: "POST", headers, body: raw });
  }
  async email(_a: ApprovalArgs & { to: string }): Promise<void> {
    throw new Error("email transport not configured for webhook notifications");
  }
}

/** Email transport: real SMTP would go here. v1 fails loudly at save time
 * when no relay is configured, never silently mid-run. */
export class SmtpTransport implements NotifyTransport {
  async desktop(_a: ApprovalArgs): Promise<void> {}
  async webhook(_a: ApprovalArgs & { url: string }): Promise<void> {}
  async email(_a: ApprovalArgs & { to: string }): Promise<void> {
    const host = process.env.PATCHBAY_SMTP_HOST;
    if (!host) throw new Error("no SMTP relay configured: email approvals disabled until PATCHBAY_SMTP_HOST is set");
    throw new Error("SMTP not yet wired; PATCHBAY_SMTP_HOST set but no transporter implemented");
  }
}

export function defaultTransport(): NotifyTransport {
  return new ConsoleDesktopTransport();
}
