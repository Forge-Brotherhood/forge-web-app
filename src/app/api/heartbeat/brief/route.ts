import { heartbeatRoute, noStore, readBody } from "@/lib/heartbeat/http";
import { putBrief, putBriefSchema } from "@/lib/heartbeat/deviceApi";
import { prismaHeartbeatStore as store } from "@/lib/heartbeat/prismaStore";

export const runtime = "nodejs";

// PUT /api/heartbeat/brief
// Stores the working brief, encrypted on the device. The server cannot read it.
export const PUT = heartbeatRoute("api.heartbeat.brief.put", async ({ userId, request, log }) => {
  const body = await readBody(request, putBriefSchema);
  const result = await putBrief(store, userId, body, new Date());
  if (result === "no_grant") return noStore({ error: "No grant on file", code: result }, 409);
  if (result === "key_mismatch") return noStore({ error: "The brief is under a different key than the grant", code: result }, 409);
  log({ event: "stored", ciphertextChars: body.ciphertext.length });
  return noStore({ success: true });
});
