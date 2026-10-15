/**
 * Server error reporting. If ERROR_WEBHOOK_URL is set (e.g. a Slack/Teams incoming webhook or your own
 * endpoint), unhandled server errors are posted there as JSON. No customer data is sent: only the error
 * message, the route and a digest. Errors are always written to the server log.
 */
export async function register() {
  await import("./lib/env-cleanup");
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
