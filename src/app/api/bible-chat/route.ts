import { NextRequest } from "next/server";
import { z } from "zod";
import { handleChatRequest } from "@/lib/chat/handleChatRequest";

export const runtime = "nodejs";

const requestSchema = z.object({
  conversationId: z.string().min(1).max(128).optional(),
  message: z.string().min(1).max(4000),
  // Bible endpoint requires explicit passage context.
  verseReference: z.string().min(1).max(200),
  verseText: z.string().min(1).max(8000).optional(),
  // Required for start, optional for follow-ups.
  selectionState: z.enum(["selected", "visible"]).optional(),
  includeSuggestedQuestions: z.boolean().optional(),
}).superRefine((val, ctx) => {
  const isStart = val.message.trim() === "BIBLE_CHAT_START";
  if (isStart && !val.selectionState) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selectionState"],
      message: 'selectionState is required for "BIBLE_CHAT_START".',
    });
  }
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = requestSchema.parse(body);
    return await handleChatRequest({
      request,
      surface: "bible",
      input: {
        conversationId: input.conversationId,
        message: input.message,
        entrypoint: "bible_reader",
        mode: "bible",
        verseReference: input.verseReference,
        verseText: input.verseText,
        selectionState: input.selectionState,
        includeSuggestedQuestions: input.includeSuggestedQuestions ?? true,
      },
      force: { entrypoint: "bible_reader", mode: "bible" },
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
          event: "bible_route_validation_failed",
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
        event: "bible_route_failed",
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

