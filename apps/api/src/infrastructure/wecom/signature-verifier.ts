import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";

export interface WeComSignatureVerifierOptions {
  token: string;
  encodingAesKey: string;
  corpId: string;
}

export function decodeWeComEncodingAesKey(encodingAesKey: string): Buffer {
  const normalizedEncodingAesKey = encodingAesKey.trim();
  if (!/^[A-Za-z0-9+/]{43}$/.test(normalizedEncodingAesKey)) {
    throw new Error("enterprise WeChat encoding AES key is invalid");
  }
  const key = Buffer.from(`${normalizedEncodingAesKey}=`, "base64");
  const canonicalValue = key.toString("base64").replace(/=+$/, "");
  if (key.length !== 32 || canonicalValue !== normalizedEncodingAesKey) {
    throw new Error("enterprise WeChat encoding AES key is invalid");
  }
  return key;
}

export class WeComSignatureVerifier {
  constructor(private readonly options: WeComSignatureVerifierOptions) {}

  verify(signature: string, timestamp: string, nonce: string, encrypt: string): boolean {
    if (!this.options.token) return false;
    const expected = createHash("sha1").update([this.options.token, timestamp, nonce, encrypt].sort().join("")).digest("hex");
    const expectedBytes = Buffer.from(expected, "utf8");
    const actualBytes = Buffer.from(signature, "utf8");
    return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
  }

  decrypt(encryptedBody: string): string {
    if (!this.options.encodingAesKey) throw new Error("enterprise WeChat encoding AES key is required");
    const key = decodeWeComEncodingAesKey(this.options.encodingAesKey);
    const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
    // WeCom pads to 32 bytes, not the 16-byte AES block size used by Node's default.
    decipher.setAutoPadding(false);
    const padded = Buffer.concat([decipher.update(Buffer.from(encryptedBody, "base64")), decipher.final()]);
    const padding = padded[padded.length - 1];
    if (!padding || padding > 32 || padding > padded.length || !padded.subarray(-padding).every((byte) => byte === padding)) {
      throw new Error("enterprise WeChat callback padding is invalid");
    }
    const decrypted = padded.subarray(0, -padding);
    if (decrypted.length < 20) throw new Error("enterprise WeChat callback message is invalid");
    const messageLength = decrypted.readUInt32BE(16);
    const messageStart = 20;
    const messageEnd = messageStart + messageLength;
    if (messageEnd > decrypted.length) throw new Error("enterprise WeChat callback message is invalid");
    const corpId = decrypted.subarray(messageEnd).toString("utf8");
    if (corpId !== this.options.corpId) throw new Error("enterprise WeChat callback corp id mismatch");
    return decrypted.subarray(messageStart, messageEnd).toString("utf8");
  }
}
