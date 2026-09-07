import { createCipheriv, createHash } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it, onTestFinished } from "vitest";

import { createInventoryMemoryState } from "../../../apps/api/src/application/inventory/inventory-memory-state.js";
import { InMemoryOutboundStore, OutboundService } from "../../../apps/api/src/application/inventory/outbound-service.js";
import { ApprovalSyncService, InMemoryApprovalSyncStore } from "../../../apps/api/src/application/wecom/approval-sync-service.js";
import { HttpApprovalGateway } from "../../../apps/api/src/infrastructure/wecom/approval-gateway.js";
import { ApprovalParser } from "../../../apps/api/src/infrastructure/wecom/approval-parser.js";
import { WeComSignatureVerifier } from "../../../apps/api/src/infrastructure/wecom/signature-verifier.js";
import { registerApprovalCallbackRoute } from "../../../apps/api/src/routes/wecom/approval-callback.js";

const key = Buffer.alloc(32, 7);
const corpId = "test-callback-corp";
const token = "test-callback-token";
const timestamp = "1788760800";
const nonce = "test-callback-nonce";
const spNo = "202609070001";

function callbackRequest(message: string, receiver = corpId) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(Buffer.byteLength(message));
  const plain = Buffer.concat([Buffer.alloc(16, 1), length, Buffer.from(message), Buffer.from(receiver)]);
  const padding = 32 - plain.length % 32;
  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.alloc(padding, padding)])), cipher.final()]).toString("base64");
  const signature = createHash("sha1").update([token, timestamp, nonce, encrypted].sort().join("")).digest("hex");
  return {
    method: "POST" as const,
    url: `/wecom/approval/callback?msg_signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`,
    headers: { "content-type": "application/xml; charset=utf-8" },
    payload: `<xml><ToUserName><![CDATA[${corpId}]]></ToUserName><Encrypt><![CDATA[${encrypted}]]></Encrypt><AgentID>1</AgentID></xml>`,
  };
}

function harness() {
  const state = createInventoryMemoryState();
  const store = new InMemoryApprovalSyncStore(state);
  const outboundStore = new InMemoryOutboundStore(state);
  const outbound = new OutboundService(outboundStore);
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/gettoken")) return new Response(JSON.stringify({ access_token: "test-token" }));
    if (!url.pathname.endsWith("/getapprovaldetail")) throw new Error("unexpected upstream request");
    return new Response(JSON.stringify({ info: {
      sp_no: spNo, template_id: "tpl-intent-v2", sp_status: 2, apply_time: 1788760800,
      applyer: { userid: "test-applicant" }, apply_data: { contents: [
        { control: "Textarea", title: [{ text: "用途" }], value: { text: "验收，请勿实际出库" } },
        { control: "Table", title: [{ text: "物品明细" }], value: { children: [
          { list: [
            { control: "Text", title: [{ text: "意向物品名称" }], value: { text: "白酒" } },
            { control: "Text", title: [{ text: "审批数量及单位" }], value: { text: "2瓶" } },
          ] },
          { list: [
            { control: "Text", title: [{ text: "意向物品名称" }], value: { text: "茶叶" } },
            { control: "Text", title: [{ text: "审批数量及单位" }], value: { text: "1盒" } },
          ] },
        ] } },
      ] },
    } }));
  };
  const service = new ApprovalSyncService({
    gateway: new HttpApprovalGateway({ corpId, secret: "test-secret", fetcher }),
    parser: new ApprovalParser(() => { throw new Error("intent must not bind an item"); }, "tpl-intent-v2"),
    store, approvalTemplateIds: ["tpl-intent-v2"],
  });
  const app = Fastify();
  registerApprovalCallbackRoute(app, {
    verifier: new WeComSignatureVerifier({ token, encodingAesKey: key.toString("base64").replace(/=+$/, ""), corpId }),
    syncService: service,
  });
  onTestFinished(() => app.close());
  return { app, store, outbound, outboundStore };
}

describe("real-format encrypted XML approval callback", () => {
  it("makes an approved two-line request available for outbound without issuing stock", async () => {
    const { app, store, outbound, outboundStore } = harness();
    const response = await app.inject(callbackRequest(`<xml><Event><![CDATA[sys_approval_change]]></Event><ApprovalInfo><SpNo><![CDATA[${spNo}]]></SpNo><SpStatus>2</SpStatus></ApprovalInfo></xml>`));

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("success");
    expect(await outbound.listPending()).toMatchObject([{
      weComSpNo: spNo, status: "PENDING_OUTBOUND", lines: [
        { requestedItemName: "白酒", requestedQuantity: "2", unit: "瓶" },
        { requestedItemName: "茶叶", requestedQuantity: "1", unit: "盒" },
      ],
    }]);
    expect(store.attempts()).toMatchObject([{ status: "SUCCEEDED" }]);
    expect(outboundStore.ledger()).toEqual([]);
    expect(outboundStore.decisions()).toEqual([]);
  });

  it("accepts text/xml and duplicate deliveries without creating duplicate approvals or issuing stock", async () => {
    const { app, store, outbound, outboundStore } = harness();
    const request = callbackRequest(`<xml><ApprovalInfo><SpNo>${spNo}</SpNo></ApprovalInfo></xml>`);
    request.headers["content-type"] = "text/xml";

    expect((await app.inject(request)).statusCode).toBe(200);
    expect((await app.inject(request)).statusCode).toBe(200);
    expect(await outbound.listPending()).toHaveLength(1);
    expect(store.attempts().map(({ status }) => status)).toEqual(["SUCCEEDED", "SUCCEEDED"]);
    expect(outboundStore.ledger()).toEqual([]);
    expect(outboundStore.decisions()).toEqual([]);
  });

  it("rejects tampered signatures before any synchronization", async () => {
    const { app, store, outbound } = harness();
    const request = callbackRequest(`<xml><SpNo>${spNo}</SpNo></xml>`);
    request.url = request.url.replace(/msg_signature=[^&]+/, "msg_signature=invalid");

    expect((await app.inject(request)).statusCode).toBe(403);
    expect(store.attempts()).toEqual([]);
    expect(await outbound.listPending()).toEqual([]);
  });

  it("rejects encrypted messages for another corporation without leaking decryption details", async () => {
    const { app, store } = harness();
    const response = await app.inject(callbackRequest(`<xml><SpNo>${spNo}</SpNo></xml>`, "different-corp"));

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "invalid callback encryption" });
    expect(store.attempts()).toEqual([]);
  });

  it.each([
    `<xml><SpNo>${spNo}</SpNo><SpNo>202609070002</SpNo></xml>`,
    `<xml><SpNo>${spNo}</SpNo><SpNo></xml>`,
    `<xml><SpNo><![CDATA[not-an-approval]]></SpNo></xml>`,
    '<!DOCTYPE xml [<!ENTITY sp SYSTEM "file:///etc/passwd">]><xml><SpNo>&sp;</SpNo></xml>',
  ])("rejects ambiguous or unsafe decrypted approval numbers: %s", async (message) => {
    const { app, store } = harness();

    expect((await app.inject(callbackRequest(message))).statusCode).toBe(400);
    expect(store.attempts()).toEqual([]);
  });

  it("rejects duplicate encrypted fields rather than choosing one", async () => {
    const { app, store } = harness();
    const request = callbackRequest(`<xml><SpNo>${spNo}</SpNo></xml>`);
    request.payload = request.payload.replace("</xml>", "<Encrypt>duplicate</Encrypt></xml>");

    expect((await app.inject(request)).statusCode).toBe(400);
    expect(store.attempts()).toEqual([]);
  });

  it("does not enable XML request bodies for unrelated API routes", async () => {
    const { app } = harness();
    app.post("/unrelated", async () => ({ accepted: true }));
    const response = await app.inject({ method: "POST", url: "/unrelated", headers: { "content-type": "application/xml" }, payload: "<xml/>" });

    expect(response.statusCode).toBe(415);
  });

  it("answers the encrypted callback URL handshake", async () => {
    const { app } = harness();
    const request = callbackRequest("echo-verification");
    const encrypted = /<!\[CDATA\[([^\]]+)\]\]><\/Encrypt>/.exec(request.payload)![1];
    const response = await app.inject({ method: "GET", url: `${request.url}&echostr=${encodeURIComponent(encrypted)}` });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("echo-verification");
  });

  it("keeps encrypted JSON callbacks compatible", async () => {
    const { app, outbound } = harness();
    const request = callbackRequest(JSON.stringify({ SpNo: spNo }));
    const encrypted = /<!\[CDATA\[([^\]]+)\]\]><\/Encrypt>/.exec(request.payload)![1];
    request.payload = JSON.stringify({ Encrypt: encrypted });
    request.headers["content-type"] = "application/json";

    expect((await app.inject(request)).statusCode).toBe(200);
    expect(await outbound.listPending()).toHaveLength(1);
  });

  it("enforces the request size limit before processing XML", async () => {
    const { app, store } = harness();
    const request = callbackRequest(`<xml><SpNo>${spNo}</SpNo></xml>`);
    request.payload += " ".repeat(1024 * 1024);

    expect((await app.inject(request)).statusCode).toBe(413);
    expect(store.attempts()).toEqual([]);
  });
});
