import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";

export interface WeComSignatureVerifierOptions {
  token: string;
  encodingAesKey: string;
  corpId: string;
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
    const key = Buffer.from(`${this.options.encodingAesKey}=`, "base64");
    if (key.length !== 32) throw new Error("enterprise WeChat encoding AES key is invalid");
    const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedBody, "base64")), decipher.final()]);
    const messageLength = decrypted.readUInt32BE(16);
    const messageStart = 20;
    const messageEnd = messageStart + messageLength;
    const corpId = decrypted.subarray(messageEnd).toString("utf8");
    if (corpId !== this.options.corpId) throw new Error("enterprise WeChat callback corp id mismatch");
    return decrypted.subarray(messageStart, messageEnd).toString("utf8");
  }
}
