import { z } from "zod";
import { NextRequest } from "next/server";
import { handleChatRequest } from "@/lib/chat/handleChatRequest";
import type { ChatEntrypoint, ChatMode } from "@/lib/chat/chatContextBundle";

export const runtime = "nodejs";

const entrypointSchema = z.enum(["bible_reader", "home", "community", "other"]);
const modeSchema = z.enum(["general", "bible"]);

const requestSchema = z.object({
  conversationId: z.string().min(1).max(128).optional(),
  message: z.string().min(1).max(4000),
  entrypoint: entrypointSchema.optional(),
  mode: modeSchema.optional(),
  verseReference: z.string().min(1).max(200).optional(),
  verseText: z.string().min(1).max(8000).optional(),
  selectionState: z.enum(["selected", "visible"]).optional(),
  includeSuggestedQuestions: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = requestSchema.parse(body);
    return await handleChatRequest({
      request,
      surface: "general",
      input: input as unknown as {
        conversationId?: string;
        message: string;
        entrypoint?: ChatEntrypoint;
        mode?: ChatMode;
        verseReference?: string;
        verseText?: string;
        selectionState?: "selected" | "visible";
        includeSuggestedQuestions?: boolean;
      },
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


