import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { chatEndRequestSchema, endChat } from "@/lib/chatSessions/endChat";

export const runtime = "nodejs";

// POST /api/chat/end
export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuth();
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await endChat(chatEndRequestSchema.parse(body)));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request data", details: error.issues }, { status: 400 });
    }
    console.error("[chat/end] failed:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ error: "Failed to end chat" }, { status: 500 });
  }
}
