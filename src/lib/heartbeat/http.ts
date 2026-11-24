import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { isHeartbeatEnabled } from "@/lib/heartbeat/config";
import { HeartbeatNotConfigured, getBriefKeyVault, type BriefKeyVault } from "@/lib/heartbeat/kms";

/**
 * The shared shell of the app-facing heartbeat routes: sign-in, no-store, errors, and one log line
 * with ids and sizes only (never a body, a key or an error message, which can quote what it choked on).
 */

export const noStore = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export const unavailable = () => noStore({ error: "The heartbeat is not available" }, 503);

/** The KMS vault, or null when the switch is off or AWS is not configured. Revoking never needs it. */
export function briefKeyVaultIfAvailable(): BriefKeyVault | null {
  if (!isHeartbeatEnabled()) return null;
  try {
    return getBriefKeyVault();
  } catch (error) {
    if (error instanceof HeartbeatNotConfigured) return null;
    throw error;
  }
}

export type Ctx = { userId: string; request: NextRequest; log: (extra?: Record<string, string | number | boolean>) => void };

export const heartbeatRoute =
  (tag: string, handler: (ctx: Ctx) => Promise<NextResponse>) =>
  async (request: NextRequest): Promise<NextResponse> => {
    const startedAt = Date.now();
    try {
      const authResult = await getAuth();
      if (!authResult) return noStore({ error: "Unauthorized" }, 401);
      const { userId } = authResult;
      return await handler({
        userId,
        request,
        log: (extra = {}) =>
          console.info(JSON.stringify({ tag, userId, ...extra, latencyMs: Date.now() - startedAt })),
      });
    } catch (error) {
      if (error instanceof z.ZodError) return noStore({ error: "Invalid request data" }, 400);
      console.error(JSON.stringify({ tag, event: "failed", error: error instanceof Error ? error.name : "unknown", latencyMs: Date.now() - startedAt }));
      return noStore({ error: "Heartbeat request failed" }, 500);
    }
  };

/** The JSON body, checked. A bad or missing body is a ZodError, which the shell answers with 400. */
export async function readBody<T extends z.ZodType>(request: NextRequest, schema: T): Promise<z.infer<T>> {
  return schema.parse(await request.json().catch(() => null));
}
