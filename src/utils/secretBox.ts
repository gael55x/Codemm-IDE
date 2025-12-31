import crypto from "crypto";

type SecretBoxPayloadV1 = {
  v: 1;
  alg: "aes-256-gcm";
  iv_b64: string;
  tag_b64: string;
  ct_b64: string;
};

function getEncryptionKeyOrThrow(): Buffer {
  const raw = process.env.CODEMM_USER_KEY_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) {
    throw new Error("Missing CODEMM_USER_KEY_ENCRYPTION_KEY (required to store per-user API keys).");
  }

  // Prefer base64, but accept 64-char hex too.
  const trimmed = raw.trim();
  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "hex");
  } else {
    try {
      key = Buffer.from(trimmed, "base64");
    } catch {
      key = null;
    }
  }

  if (!key || key.length !== 32) {
    throw new Error("CODEMM_USER_KEY_ENCRYPTION_KEY must decode to exactly 32 bytes (base64) or be 64 hex chars.");
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || !plaintext.trim()) {
    throw new Error("encryptSecret: plaintext must be a non-empty string.");
  }

  const key = getEncryptionKeyOrThrow();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload: SecretBoxPayloadV1 = {
    v: 1,
    alg: "aes-256-gcm",
    iv_b64: iv.toString("base64"),
    tag_b64: tag.toString("base64"),
    ct_b64: ct.toString("base64"),
  };

  return JSON.stringify(payload);
}

export function decryptSecret(payloadJson: string): string {
  let payload: SecretBoxPayloadV1;
  try {
    payload = JSON.parse(payloadJson) as SecretBoxPayloadV1;
  } catch {
    throw new Error("decryptSecret: payload is not valid JSON.");
  }

  if (!payload || payload.v !== 1 || payload.alg !== "aes-256-gcm") {
    throw new Error("decryptSecret: unsupported payload version.");
  }

  const key = getEncryptionKeyOrThrow();
  const iv = Buffer.from(payload.iv_b64, "base64");
  const tag = Buffer.from(payload.tag_b64, "base64");
  const ct = Buffer.from(payload.ct_b64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

