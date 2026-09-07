import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { WeComSignatureVerifier } from "../../../apps/api/src/infrastructure/wecom/signature-verifier.js";

function signatureFor(token: string, timestamp: string, nonce: string, encrypt: string): string {
  return createHash("sha1").update([token, timestamp, nonce, encrypt].sort().join("")).digest("hex");
}

function encryptWeComMessage(message: string, corpId: string, encodingAesKey: string): string {
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  const messageLength = Buffer.alloc(4);
  messageLength.writeUInt32BE(Buffer.byteLength(message));
  const payload = Buffer.concat([
    randomBytes(16),
    messageLength,
    Buffer.from(message),
    Buffer.from(corpId),
  ]);
  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  const padding = 32 - payload.length % 32;
  return Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.alloc(padding, padding)])), cipher.final()]).toString("base64");
}

describe("enterprise WeChat callback signature verifier", () => {
  it.each([6, 21, 300])("decrypts protocol-padded messages of %i bytes, including padding beyond one AES block", (length) => {
    const encodingAesKey = Buffer.alloc(32, 7).toString("base64").replace(/=+$/, "");
    const verifier = new WeComSignatureVerifier({ token: "test-token", encodingAesKey, corpId: "corp-1" });
    const message = "x".repeat(length);

    expect(verifier.decrypt(encryptWeComMessage(message, "corp-1", encodingAesKey))).toBe(message);
  });

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

  it.each(["zero padding", "oversized padding", "inconsistent padding", "out-of-bounds message length"])("rejects %s", (invalidCase) => {
    const key = Buffer.alloc(32, 7);
    const verifier = new WeComSignatureVerifier({ token: "test-token", encodingAesKey: key.toString("base64").replace(/=+$/, ""), corpId: "corp-1" });
    const plain = Buffer.alloc(32);
    if (invalidCase === "oversized padding") plain.fill(33);
    if (invalidCase === "inconsistent padding") { plain.fill(5, 27); plain[30] = 4; }
    if (invalidCase === "out-of-bounds message length") { plain.writeUInt32BE(100, 16); plain.fill(6, 26); }
    const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]).toString("base64");

    expect(() => verifier.decrypt(encrypted)).toThrow(/callback (padding|message) is invalid/);
  });
});
