import { db, schema, type Executor } from "@/db";

export async function audit(
  entry: {
    userId?: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    details?: Record<string, unknown>;
    ip?: string | null;
  },
  exec: Executor = db,
) {
  await exec.insert(schema.auditLogs).values({
    userId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    details: entry.details ?? null,
    ip: entry.ip ?? null,
  });
}
