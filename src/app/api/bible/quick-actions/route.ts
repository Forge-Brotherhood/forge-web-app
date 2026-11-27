import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { getKVClient, CacheKeys, CACHE_TTL_SECONDS, isCacheFresh } from "@/lib/kv";
import { getPassagePlaces } from "@/lib/guide/places";
import { parseQuickActions, quickActionsSystemPrompt, type QuickAction } from "@/lib/guide/quickActions";

/**
 * The quick actions over the reader's selection bar for the selected verses. Only the reference
 * and the verse text come in, so the answer is the same for everyone and is cached by passage.
 */
const requestSchema = z.object({
  verseReference: z.string().min(1).max(120),
  verseText: z.string().min(1).max(5000),
  translation: z.string().min(1).max(12).default("BSB"),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request data" }, 400);
  const { verseReference, verseText, translation } = parsed.data;

  const kv = getKVClient();
  const key = CacheKeys.quickActions(translation, verseReference);
  try {
    const cached = await kv.get<QuickAction[]>(key);
    if (cached && isCacheFresh(cached.lastRefreshedAt)) return json({ actions: cached.data });
  } catch (error) {
    console.error("[quick-actions] cache read failed:", error);
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) return json({ error: "AI service not configured" }, 500);

  const passage = await getPassagePlaces(verseReference, "selected").catch(() => null);
  const placeNames = passage?.places.map((p) => p.name) ?? [];

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiApiKey}` },
    body: JSON.stringify({
      model: process.env.QUICK_ACTIONS_MODEL || "gpt-4.1-mini",
      messages: [
        { role: "system", content: quickActionsSystemPrompt(placeNames) },
        { role: "user", content: `${verseReference} (${translation})\n\n${verseText}` },
      ],
      temperature: 0.2,
      max_tokens: 200,
      response_format: { type: "json_object" },
    }),
  }).catch(() => null);
  if (!resp?.ok) return json({ error: "AI service error" }, 502);

  const data = (await resp.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
  const actions = parseQuickActions(data?.choices?.[0]?.message?.content ?? "", { hasPlaces: placeNames.length > 0, reference: verseReference });
  if (actions.length === 0) return json({ error: "No quick actions" }, 502);

  try {
    await kv.set(key, actions, CACHE_TTL_SECONDS);
  } catch (error) {
    console.error("[quick-actions] cache write failed:", error);
  }
  return json({ actions });
}
