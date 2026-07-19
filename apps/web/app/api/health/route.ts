import { environment, databaseClient } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const config = environment();
  const databaseHealthy = await databaseClient()
    .pool.query("SELECT 1")
    .then(() => true)
    .catch(() => false);

  return Response.json(
    {
      service: "web",
      status: databaseHealthy ? "ready" : "degraded",
      database: databaseHealthy ? "ready" : "unavailable",
      dryRun: config.GLOBAL_DRY_RUN,
      emailSendEnabled: config.EMAIL_SEND_ENABLED,
      autonomousSendEnabled: config.AUTONOMOUS_SEND_ENABLED,
      requiredWebsite: config.REQUIRED_OUTREACH_WEBSITE
    },
    {
      status: databaseHealthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
