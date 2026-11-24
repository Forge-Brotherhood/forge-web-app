import { ackOutboxSchema } from "@/lib/heartbeat/deviceApi";
import { heartbeatRoute, noStore, readBody } from "@/lib/heartbeat/http";
import { prismaHeartbeatStore as store } from "@/lib/heartbeat/prismaStore";

export const runtime = "nodejs";

// POST /api/heartbeat/outbox/ack
// Deletes the items the app has taken and applied.
export const POST = heartbeatRoute("api.heartbeat.outbox.ack", async ({ userId, request, log }) => {
  const { ids } = await readBody(request, ackOutboxSchema);
  const deleted = await store.ackOutbox(userId, ids);
  log({ event: "acked", requested: ids.length, deleted });
  return noStore({ success: true, deleted });
});
