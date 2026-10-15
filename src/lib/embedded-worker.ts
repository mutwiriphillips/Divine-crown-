import { processJobs, scheduledTick } from "@/lib/worker-tasks";

const g = globalThis as unknown as { __embeddedWorker?: boolean };

/** Background loop inside the web process. Safe alongside other workers: jobs are claimed with row locks. */
export function startEmbeddedWorker() {
  if (g.__embeddedWorker) return;
  g.__embeddedWorker = true;
  const id = `web:${process.pid}`;
  let running = false;
  let lastTick = 0;
  const loop = async () => {
    if (running) return;
    running = true;
    try {
      if (Date.now() - lastTick > 30_000) {
        await scheduledTick();
        lastTick = Date.now();
      }
      await processJobs(id);
    } catch (e) {
      console.error("[embedded worker]", (e as Error).message);
    } finally {
      running = false;
    }
  };
  const t = setInterval(loop, 5000);
  t.unref?.();
  console.log("Background worker running inside the web process.");
}
