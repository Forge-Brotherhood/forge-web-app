import { z } from "zod";
import { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";
import { chatRequestFields, handleChatRequest, refineChatRequest } from "@/lib/chat/handleChatRequest";

export const runtime = "nodejs";

const entrypointSchema = z.enum(["bible_reader", "home", "community", "other"]);
const modeSchema = z.enum(["general", "bible"]);

const requestSchema = z
  .object({
    ...chatRequestFields,
    entrypoint: entrypointSchema.optional(),
    mode: modeSchema.optional(),
    verseReference: z.string().min(1).max(200).optional(),
  })
  .superRefine(refineChatRequest);

export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const body = await request.json().catch(() => ({}));
    const input = requestSchema.parse(body);
    return await handleChatRequest({
      request,
      userId: authResult.userId,
      surface: "general",
      input,
      force: { mode: "general" },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      const correlationId =
        request.headers.get("x-request-id") ??
        request.headers.get("x-vercel-id") ??
        request.headers.get("cf-ray") ??
        crypto.randomUUID();
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          tag: "api.chat",
          event: "request_validation_failed",
          correlationId,
          path: new URL(request.url).pathname,
          issues: err.issues,
        })
      );
      return new Response(JSON.stringify({ error: "Invalid request data", details: err.issues }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    const correlationId =
      request.headers.get("x-request-id") ??
      request.headers.get("x-vercel-id") ??
      request.headers.get("cf-ray") ??
      crypto.randomUUID();
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        tag: "api.chat",
        event: "route_failed",
        correlationId,
        path: new URL(request.url).pathname,
        error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack?.slice(0, 4000) } : { message },
      })
    );
    return new Response(JSON.stringify({ error: "Failed to chat", details: message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}


