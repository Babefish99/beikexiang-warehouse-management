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
  // Read only the attribute-free WeCom protocol subset, not arbitrary XML.
  // A bounded stack validates structure; declarations, comments and entities fail closed.
  const stack: string[] = [];
  let cursor = 0;
  let roots = 0;
  let fields = 0;
  let value = "";
  const tokens = /<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*\s*\/?>|[^<]+/g;
  for (const token of xml.matchAll(tokens)) {
    if (token.index !== cursor) return undefined;
    const text = token[0];
    cursor += text.length;
    if (text.startsWith("<![CDATA[") || !text.startsWith("<")) {
      const cdata = text.startsWith("<![CDATA[");
      const content = cdata ? text.slice(9, -3) : text;
      if ((!stack.length && (cdata || content.trim())) || (!cdata && /&|\]\]>/.test(content))) return undefined;
      if (stack.at(-1) === field) value += content;
      continue;
    }
    const closing = text.startsWith("</");
    const name = text.slice(closing ? 2 : 1).replace(/\s*\/?>$/, "");
    if (closing) {
      if (text.endsWith("/>") || stack.pop() !== name) return undefined;
    } else {
      if (stack.includes(field) || stack.length >= 64) return undefined;
      if (!stack.length && (++roots !== 1 || name !== "xml")) return undefined;
      if (name === field && ++fields !== 1) return undefined;
      if (!text.endsWith("/>")) stack.push(name);
    }
  }
  return cursor === xml.length && roots === 1 && stack.length === 0 && fields === 1 ? value.trim() : undefined;
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
