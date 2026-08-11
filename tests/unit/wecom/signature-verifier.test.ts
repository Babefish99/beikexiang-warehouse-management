import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { WeComSignatureVerifier } from "../../../apps/api/src/infrastructure/wecom/signature-verifier.js";

function signatureFor(token: string, timestamp: string, nonce: string, encrypt: string): string {
  return createHash("sha1").update([token, timestamp, nonce, encrypt].sort().join("")).digest("hex");
}

function encryptWeComMessage(message: string, corpId: string, encodingAesKey: string): string {
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  const payload = Buffer.concat([
    randomBytes(16),
    Buffer.from([0, 0, 0, Buffer.byteLength(message)]),
    Buffer.from(message),
    Buffer.from(corpId),
  ]);
  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  return Buffer.concat([cipher.update(payload), cipher.final()]).toString("base64");
}

describe("enterprise WeChat callback signature verifier", () => {
  it("accepts the sorted SHA-1 callback signature and rejects tampering", () => {
    const verifier = new WeComSignatureVerifier({ token: "callback-token", encodingAesKey: "", corpId: "corp-1" });
    const signature = signatureFor("callback-token", "1784773140", "nonce-1", "encrypted-message");

    expect(verifier.verify(signature, "1784773140", "nonce-1", "encrypted-message")).toBe(true);
    expect(verifier.verify("bad-signature", "1784773140", "nonce-1", "encrypted-message")).toBe(false);
    const unconfiguredSignature = signatureFor("", "1784773140", "nonce-1", "encrypted-message");
    expect(new WeComSignatureVerifier({ token: "", encodingAesKey: "", corpId: "corp-1" }).verify(unconfiguredSignature, "1784773140", "nonce-1", "encrypted-message")).toBe(false);
  });

  it("decrypts and validates an encrypted callback body", () => {
    const encodingAesKey = randomBytes(32).toString("base64").replace(/=+$/, "");
    const verifier = new WeComSignatureVerifier({ token: "callback-token", encodingAesKey, corpId: "corp-1" });
    const encrypted = encryptWeComMessage("{\"SpNo\":\"202607230021\"}", "corp-1", encodingAesKey);

    expect(verifier.decrypt(encrypted)).toBe('{"SpNo":"202607230021"}');
  });

  it("normalizes surrounding EncodingAESKey whitespace before decrypting a callback", () => {
    const encodingAesKey = randomBytes(32).toString("base64").replace(/=+$/, "");
    const verifier = new WeComSignatureVerifier({
      token: "callback-token",
      encodingAesKey: ` \t${encodingAesKey}\r\n`,
      corpId: "corp-1",
    });
    const encrypted = encryptWeComMessage("{\"SpNo\":\"202607230022\"}", "corp-1", encodingAesKey);

    expect(verifier.decrypt(encrypted)).toBe('{"SpNo":"202607230022"}');
  });
});
