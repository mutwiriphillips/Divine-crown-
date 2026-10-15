/**
 * Background worker: sends queued notifications (with retries), releases expired stock holds,
 * reconciles M-Pesa payments and runs daily summaries / low-stock checks.
 *   npm run worker
 * Run exactly one or more copies alongside the web server (jobs are claimed with row locks, so
 * several workers never process the same job). On serverless hosting, call /api/cron/tick instead.
 */
import "dotenv/config";
import "../src/lib/env-cleanup";
import { hostname } from "node:os";
import { getPool } from "@/db";
import { processJobs, scheduledTick } from "@/lib/worker-tasks";

const id = `${hostname()}:${process.pid}`;
let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

async function main() {
  console.log(`Worker ${id} started.`);
  let lastTick = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastTick > 30_000) {
        const r = await scheduledTick();
        if (r.expiredOrders || r.reconciledPayments) console.log(new Date().toISOString(), r);
        lastTick = Date.now();
      }
      const n = await processJobs(id);
      if (n === 0) await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      console.error("Worker loop error", e);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await getPool().end();
  console.log("Worker stopped.");
}
main();
