import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";

/**
 * Vault: AES-256-GCM values, master key from a user passphrase via scrypt.
 * Values live in the SQLite `vault` table. Key material never appears in
 * board files, logs, or exports. Losing the passphrase loses the keys.
 */
export class Vault {
  private key!: Buffer;
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS vault(
      key TEXT PRIMARY KEY, value_enc BLOB NOT NULL, updated_at TEXT NOT NULL,
      owner_id TEXT NOT NULL DEFAULT 'local')`);
  }

  /** Derive and hold the master key. Call once at startup. */
  unlock(passphrase: string, saltHex?: string): { salt: string } {
    const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
    // scrypt, N=2^15, r=8, p=1 per spec §8
    this.key = crypto.scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 32768 * 16 * 2 });
    return { salt: salt.toString("hex") };
  }

  set(key: string, plaintext: string): void {
    if (!this.key) throw new Error("vault is locked");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([iv, cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
    this.db.prepare(
      `INSERT INTO vault(key,value_enc,updated_at) VALUES(?,?,?)
       ON CONFLICT(key) DO UPDATE SET value_enc=excluded.value_enc, updated_at=excluded.updated_at`)
      .run(key, enc, new Date().toISOString());
  }

  get(key: string): string | undefined {
    if (!this.key) throw new Error("vault is locked");
    const row = this.db.prepare("SELECT value_enc FROM vault WHERE key=?").get(key) as
      { value_enc: Buffer | Uint8Array } | undefined;
    if (!row) return undefined;
    const buf = Buffer.isBuffer(row.value_enc) ? row.value_enc : Buffer.from(row.value_enc);
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const ciphertext = buf.subarray(12, buf.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }

  keys(): string[] {
    return (this.db.prepare("SELECT key FROM vault ORDER BY key").all() as { key: string }[]).map((r) => r.key);
  }

  delete(key: string): boolean {
    const r = this.db.prepare("DELETE FROM vault WHERE key=?").run(key);
    return r.changes > 0;
  }
}
