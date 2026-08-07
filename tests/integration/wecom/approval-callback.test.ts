import { createHash } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { registerApprovalCallbackRoute } from "../../../apps/api/src/routes/wecom/approval-callback.js";

function signatureFor(token: string, timestamp: string, nonce: string, body: string): string {
  return createHash("sha1").update([token, timestamp, nonce, body].sort().join("")).digest("hex");
}

describe("enterprise WeChat approval callback", () => {
  it("acknowledges a valid callback and forwards the approval number", async () => {
    const app = Fastify();
    const syncService = { handleCallback: vi.fn().mockResolvedValue(undefined) };
    registerApprovalCallbackRoute(app, {
      token: "callback-token",
      verifier: { verify: (signature, timestamp, nonce, body) => signature === signatureFor("callback-token", timestamp, nonce, body) },
      syncService,
    });
    const body = JSON.stringify({ SpNo: "202607230021" });
    const response = await app.inject({
      method: "POST",
      url: `/wecom/approval/callback?msg_signature=${signatureFor("callback-token", "1784773140", "nonce-1", body)}&timestamp=1784773140&nonce=nonce-1`,
      payload: body,
      headers: { "content-type": "application/json" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("success");
    expect(syncService.handleCallback).toHaveBeenCalledWith({ spNo: "202607230021", rawPayload: { SpNo: "202607230021" } });
  });

  it("rejects a callback with an invalid signature before synchronization", async () => {
    const app = Fastify();
    const syncService = { handleCallback: vi.fn() };
    registerApprovalCallbackRoute(app, {
      token: "callback-token",
      verifier: { verify: () => false },
      syncService,
    });

    const response = await app.inject({ method: "POST", url: "/wecom/approval/callback?msg_signature=bad&timestamp=1&nonce=nonce", payload: JSON.stringify({ SpNo: "202607230021" }), headers: { "content-type": "application/json" } });

    expect(response.statusCode).toBe(403);
    expect(syncService.handleCallback).not.toHaveBeenCalled();
  });
});
