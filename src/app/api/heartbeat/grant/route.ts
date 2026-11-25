import { heartbeatRoute, briefKeyVaultIfAvailable, noStore, readBody, unavailable } from "@/lib/heartbeat/http";
import { putGrant, putGrantSchema } from "@/lib/heartbeat/deviceApi";
import { prismaHeartbeatStore as store } from "@/lib/heartbeat/prismaStore";
import { appNow } from "@/lib/devClock";

export const runtime = "nodejs";

// PUT /api/heartbeat/grant
// Grants (or renews, and rotates) the brief key. The key is wrapped by KMS at once and only the wrapped form is kept.
export const PUT = heartbeatRoute("api.heartbeat.grant.put", async ({ userId, request, log }) => {
  const body = await readBody(request, putGrantSchema);
  const kms = briefKeyVaultIfAvailable();
  if (!kms) return unavailable();

  const result = await putGrant({ store, kms }, userId, body, appNow());
  if (!result.ok) return noStore({ error: "Set the heartbeat state first", code: result.reason }, 409);
  log({ event: "granted" });
  return noStore({ userId, expiresAt: result.expiresAt });
});

// DELETE /api/heartbeat/grant
// Ends the grant: the wrapped key, the brief and the outbox are deleted together. Always available.
export const DELETE = heartbeatRoute("api.heartbeat.grant.delete", async ({ userId, log }) => {
  await store.deleteGrantData(userId);
  log({ event: "revoked" });
  return noStore({ success: true });
});
