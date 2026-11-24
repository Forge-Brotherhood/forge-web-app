import { OUTBOX_PAGE } from "@/lib/heartbeat/deviceApi";
import { heartbeatRoute, noStore } from "@/lib/heartbeat/http";
import { prismaHeartbeatStore as store } from "@/lib/heartbeat/prismaStore";

export const runtime = "nodejs";

// GET /api/heartbeat/outbox
// What the heartbeat produced while the app was away, oldest first, still encrypted. Nothing is deleted
// here: the app takes the items, applies them, and then acknowledges them.
export const GET = heartbeatRoute("api.heartbeat.outbox.get", async ({ userId, log }) => {
  const rows = await store.listOutbox(userId, OUTBOX_PAGE);
  log({ event: "listed", items: rows.length });
  return noStore({
    userId,
    items: rows.map((r) => ({ id: r.id, keyId: r.keyId, ciphertext: r.ciphertext, createdAt: r.createdAt.toISOString() })),
    // A full page means there may be more: ask again after acknowledging.
    more: rows.length === OUTBOX_PAGE,
  });
});
