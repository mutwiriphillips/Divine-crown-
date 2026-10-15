import { safeEqual } from "@/lib/crypto";
import { processJobs, scheduledTick } from "@/lib/worker-tasks";

/** For hosts without a long-running worker (e.g. Vercel Cron): call every minute with the CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !safeEqual(given, secret)) return new Response("Unauthorized", { status: 401 });
  const tick = await scheduledTick();
  const processed = await processJobs(`cron:${Date.now()}`, 40);
  return Response.json({ ...tick, processed });
}
