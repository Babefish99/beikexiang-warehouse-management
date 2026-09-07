import type { FastifyInstance } from "fastify";

import type { ApprovalSyncService } from "../../application/wecom/approval-sync-service.js";

interface CallbackVerifier {
  verify(signature: string, timestamp: string, nonce: string, encryptedBody: string): boolean;
  decrypt?(encryptedBody: string): string;
}

interface CallbackDependencies {
  token?: string;
  verifier: CallbackVerifier;
  syncService: Pick<ApprovalSyncService, "handleCallback">;
}

interface CallbackQuery {
  msg_signature?: string;
  timestamp?: string;
  nonce?: string;
  echostr?: string;
}

function bodyText(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body ?? "");
}

function xmlScalar(xml: string, field: "Encrypt" | "SpNo"): string | undefined {
  // Only read these scalar protocol fields; never resolve XML entities or DTDs.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return undefined;
  const opening = `<${field}>`;
  const closing = `</${field}>`;
  const start = xml.indexOf(opening);
  const end = xml.indexOf(closing);
  if (start < 0 || end < start + opening.length
    || xml.indexOf(opening, start + opening.length) !== -1
    || xml.indexOf(closing, end + closing.length) !== -1) return undefined;
  const value = xml.slice(start + opening.length, end).trim();
  if (value.startsWith("<![CDATA[") && value.endsWith("]]>")) {
    const content = value.slice(9, -3);
    return content.includes("]]>") ? undefined : content.trim();
  }
  return /[<&]/.test(value) ? undefined : value;
}

function encryptedBody(body: unknown): string | undefined {
  if (typeof body === "string") return xmlScalar(body, "Encrypt");
  if (!body || typeof body !== "object" || !("Encrypt" in body)) return undefined;
  const value = body.Encrypt;
  return typeof value === "string" ? value : undefined;
}

function approvalNumberFromBody(body: string): string | undefined {
  let value: unknown;
  try {
    const parsed = JSON.parse(body) as { SpNo?: string; sp_no?: string; EventData?: { SpNo?: string } };
    value = parsed?.SpNo ?? parsed?.sp_no ?? parsed?.EventData?.SpNo;
  } catch {
    value = xmlScalar(body, "SpNo");
  }
  return typeof value === "string" && /^\d{8,32}$/.test(value) ? value : undefined;
}

export function registerApprovalCallbackRoute(app: FastifyInstance, dependencies: CallbackDependencies): void {
  void app.register(async (callbackApp) => {
    callbackApp.addContentTypeParser(["application/xml", "text/xml"], { parseAs: "string" }, (_request, body, done) => done(null, body));
    registerCallbackHandlers(callbackApp, dependencies);
  });
}

function registerCallbackHandlers(app: FastifyInstance, dependencies: CallbackDependencies): void {
  app.get<{ Querystring: CallbackQuery }>("/wecom/approval/callback", async (request, reply) => {
    const { msg_signature: signature, timestamp, nonce, echostr } = request.query;
    if (!signature || !timestamp || !nonce || !echostr || !dependencies.verifier.verify(signature, timestamp, nonce, echostr)) {
      return reply.code(403).send({ error: "invalid callback signature" });
    }
    try {
      return dependencies.verifier.decrypt ? dependencies.verifier.decrypt(echostr) : echostr;
    } catch {
      return reply.code(403).send({ error: "invalid callback encryption" });
    }
  });

  app.post<{ Querystring: CallbackQuery; Body: unknown }>("/wecom/approval/callback", async (request, reply) => {
    const encrypted = encryptedBody(request.body);
    if (typeof request.body === "string" && request.body.trimStart().startsWith("<") && !encrypted) {
      return reply.code(400).send({ error: "encrypted callback body is required" });
    }
    const signedBody = encrypted ?? bodyText(request.body);
    const { msg_signature: signature, timestamp, nonce } = request.query;
    if (!signature || !timestamp || !nonce || !dependencies.verifier.verify(signature, timestamp, nonce, signedBody)) {
      return reply.code(403).send({ error: "invalid callback signature" });
    }
    let content: string;
    try {
      content = encrypted && dependencies.verifier.decrypt ? dependencies.verifier.decrypt(encrypted) : signedBody;
    } catch {
      return reply.code(403).send({ error: "invalid callback encryption" });
    }
    const spNo = approvalNumberFromBody(content);
    if (!spNo) return reply.code(400).send({ error: "approval number is required" });
    await dependencies.syncService.handleCallback({ spNo, rawPayload: request.body });
    return reply.code(200).send("success");
  });
}
