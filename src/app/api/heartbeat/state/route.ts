import { putStateSchema } from "@/lib/heartbeat/deviceApi";
import { briefKeyVaultIfAvailable, heartbeatRoute, noStore, readBody } from "@/lib/heartbeat/http";
import { prismaHeartbeatStore as store } from "@/lib/heartbeat/prismaStore";
import type { StateRow } from "@/lib/heartbeat/store";

export const runtime = "nodejs";

const view = (row: StateRow | null) =>
  row && {
    enabled: row.enabled,
    timezone: row.timezone,
    quietHours: { start: row.quietStart, end: row.quietEnd },
    pushEnabled: row.pushEnabled,
    nextBeatAt: row.nextBeatAt.toISOString(),
    lastBeatAt: row.lastBeatAt?.toISOString() ?? null,
  };

// GET /api/heartbeat/state
// Whether the server heartbeat is available (switched on and KMS configured), the state on file and the grant's expiry. `userId` is
// what the device needs to build the associated data for its ciphertexts.
export const GET = heartbeatRoute("api.heartbeat.state.get", async ({ userId }) => {
  const [state, grant] = await Promise.all([store.getState(userId), store.getGrant(userId)]);
  return noStore({
    userId,
    available: briefKeyVaultIfAvailable() !== null,
    state: view(state),
    grant: grant && { keyId: grant.keyId, expiresAt: grant.expiresAt.toISOString() },
  });
});

// PUT /api/heartbeat/state
export const PUT = heartbeatRoute("api.heartbeat.state.put", async ({ userId, request, log }) => {
  const body = await readBody(request, putStateSchema);
  const row = await store.putState(
    userId,
    { enabled: body.enabled, timezone: body.timezone, quietStart: body.quietHours.start, quietEnd: body.quietHours.end, pushEnabled: body.pushEnabled },
    new Date()
  );
  log({ event: "state_saved", enabled: body.enabled });
  return noStore({ userId, state: view(row) });
});
