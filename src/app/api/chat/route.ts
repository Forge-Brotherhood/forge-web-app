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
      return new Response(JSON.stringify({ error: "Invalid request data", details: err.issues }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: "Failed to chat", details: message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}


