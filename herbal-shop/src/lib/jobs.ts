import { sql } from "drizzle-orm";
import { db, schema, type Executor } from "@/db";

/**
 * Postgres-backed job queue. Jobs are inserted inside the same transaction as the business change
 * (outbox pattern), so a rolled-back sale never sends a notification and a sent notification never
 * re-runs a sale. Workers claim jobs with FOR UPDATE SKIP LOCKED.
 */
export async function enqueueJob(
  exec: Executor,
  type: string,
  payload: Record<string, unknown>,
  opts: { dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {},
) {
  await exec
    .insert(schema.jobs)
    .values({ type, payload, dedupeKey: opts.dedupeKey ?? null, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 5 })
    .onConflictDoNothing({ target: schema.jobs.dedupeKey });
}

export type JobRow = typeof schema.jobs.$inferSelect;

export async function claimJobs(workerId: string, limit = 10): Promise<JobRow[]> {
  const res = await db.execute(sql`
    update jobs set status = 'RUNNING', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1
     where id in (
       select id from jobs
        where (status = 'QUEUED' and run_at <= now())
           or (status = 'RUNNING' and locked_at < now() - interval '10 minutes')
        order by run_at
        limit ${limit}
        for update skip locked)
    returning *`);
  return res.rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    type: r.type as string,
    payload: r.payload as Record<string, unknown>,
    dedupeKey: (r.dedupe_key as string) ?? null,
    status: r.status as JobRow["status"],
    runAt: new Date(r.run_at as string),
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    lastError: (r.last_error as string) ?? null,
    lockedAt: r.locked_at ? new Date(r.locked_at as string) : null,
    lockedBy: (r.locked_by as string) ?? null,
    finishedAt: null,
    createdAt: new Date(r.created_at as string),
  }));
}

export async function completeJob(id: string) {
  await db.execute(sql`update jobs set status = 'SUCCEEDED', finished_at = now(), locked_at = null where id = ${id}`);
}

export async function failJob(job: JobRow, error: string) {
  const dead = job.attempts >= job.maxAttempts;
  // Exponential backoff: 30s, 2m, 8m, 32m...
  const delaySec = Math.min(3600 * 6, 30 * 4 ** (job.attempts - 1));
  await db.execute(sql`
    update jobs set status = ${dead ? "DEAD" : "QUEUED"}, last_error = ${error.slice(0, 2000)}, locked_at = null,
      run_at = now() + make_interval(secs => ${delaySec}), finished_at = ${dead ? sql`now()` : sql`null`}
    where id = ${job.id}`);
}
