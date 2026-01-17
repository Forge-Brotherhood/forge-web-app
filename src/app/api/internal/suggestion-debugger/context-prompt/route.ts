import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateInternalApiKey } from "../_internalApiKey";
import { CONTEXT_SYSTEM_PROMPT_NDJSON } from "@/lib/guide/contextNdjson";
import { compactContextCandidatesPayload } from "@/lib/guide/contextCompact";

const requestSchema = z.object({
  contextPayload: z.unknown(),
  userFirstName: z.string().optional().nullable(),
});

export async function POST(request: NextRequest) {
  if (!validateInternalApiKey(request)) {
    return NextResponse.json({ error: "Invalid or missing internal API key" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const input = requestSchema.parse(body);

    const compacted = compactContextCandidatesPayload(input.contextPayload);
    const userMessageContent = JSON.stringify({
      ...(compacted as any),
      user: { first_name: input.userFirstName?.trim() ? input.userFirstName.trim() : null },
    });

    return NextResponse.json({
      systemPrompt: CONTEXT_SYSTEM_PROMPT_NDJSON,
      userMessageContent,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to build context prompt preview", details: message }, { status: 500 });
  }
}


