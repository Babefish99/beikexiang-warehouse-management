import type { UserRole } from "../../application/auth/role-service.js";

export interface AuditEvent {
  actorUserId: string;
  actorRole: UserRole;
  action: string;
  entityType: string;
  entityId: string;
  requestId?: string;
  beforeData?: unknown;
  afterData?: unknown;
  occurredAt: string;
}

export interface AuditService {
  record(event: AuditEvent): Promise<void>;
}

export class InMemoryAuditService implements AuditService {
  readonly events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.events.push({ ...event, beforeData: structuredClone(event.beforeData), afterData: structuredClone(event.afterData) });
  }
}
