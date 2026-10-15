/**
 * Server start-up and error reporting.
 *
 * RUN_WORKER_IN_WEB=true runs the background jobs (sending messages, releasing unpaid stock holds, checking
 * M-Pesa payments) inside the web process. Use it on hosts with no separate worker, e.g. Render's free plan.
 * Jobs only run while the site is awake; on a paid plan run `npm run worker` as its own service instead.
 *
 * If ERROR_WEBHOOK_URL is set, unhandled server errors are posted there as JSON (error message, route and a
 * digest only: no customer data). Errors are always written to the server log.
 */
export async function register() {
  await import("./lib/env-cleanup");
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RUN_WORKER_IN_WEB === "true") {
    const { startEmbeddedWorker } = await import("./lib/embedded-worker");
    startEmbeddedWorker();
  }
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const e = err as Error & { digest?: string };
  console.error(`[error] ${request.method} ${context.routePath}: ${e?.message}`, e?.digest ?? "");
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Shop error on ${request.method} ${context.routePath}: ${String(e?.message ?? e).slice(0, 300)}`,
        route: context.routePath,
        routeType: context.routeType,
        digest: e?.digest ?? null,
        at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // never let reporting break the request
  }
}
