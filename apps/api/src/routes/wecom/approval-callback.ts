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

function encryptedBody(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("Encrypt" in body)) return undefined;
  const value = body.Encrypt;
  return typeof value === "string" ? value : undefined;
}

function approvalNumberFromBody(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { SpNo?: string; sp_no?: string; EventData?: { SpNo?: string } };
    return parsed.SpNo ?? parsed.sp_no ?? parsed.EventData?.SpNo;
  } catch {
    return /<SpNo>([^<]+)<\/SpNo>/i.exec(body)?.[1];
  }
}

export function registerApprovalCallbackRoute(app: FastifyInstance, dependencies: CallbackDependencies): void {
  app.get<{ Querystring: CallbackQuery }>("/wecom/approval/callback", async (request, reply) => {
    const { msg_signature: signature, timestamp, nonce, echostr } = request.query;
    if (!signature || !timestamp || !nonce || !echostr || !dependencies.verifier.verify(signature, timestamp, nonce, echostr)) {
      return reply.code(403).send({ error: "invalid callback signature" });
    }
    return dependencies.verifier.decrypt ? dependencies.verifier.decrypt(echostr) : echostr;
  });

  app.post<{ Querystring: CallbackQuery; Body: unknown }>("/wecom/approval/callback", async (request, reply) => {
    const encrypted = encryptedBody(request.body);
    const signedBody = encrypted ?? bodyText(request.body);
    const { msg_signature: signature, timestamp, nonce } = request.query;
    if (!signature || !timestamp || !nonce || !dependencies.verifier.verify(signature, timestamp, nonce, signedBody)) {
      return reply.code(403).send({ error: "invalid callback signature" });
    }
    const content = encrypted && dependencies.verifier.decrypt ? dependencies.verifier.decrypt(encrypted) : signedBody;
    const spNo = approvalNumberFromBody(content);
    if (!spNo) return reply.code(400).send({ error: "approval number is required" });
    await dependencies.syncService.handleCallback({ spNo, rawPayload: request.body });
    return reply.code(200).send("success");
  });
}
