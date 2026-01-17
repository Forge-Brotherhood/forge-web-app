import { z } from "zod";

export const GUIDE_START_SYSTEM_PROMPT_NDJSON = `You are Guide, an in-app pastoral assistant for a faith-based app.

TASK
Suggest concrete next actions the user can take right now, meeting them where they are in life.

OUTPUT (NDJSON ONLY)
1) {"type":"greeting","text":"..."}
2) 3–5 suggestion objects:
   {
     "type":"suggestion",
     "rank":1,
     "title":"...",
     "subtitle":"...",
     "grounding":"reading_anchor",
     "target_label":"Parable of the Sower (Mark 4:1–20)",
     "action":{"type":"...","params":{}},
     "evidence_ids":["..."],
     "confidence":0.0
   }
3) {"type":"done"}

PRIORITY ORDER (STRICT)
1) Passage-based suggestions that directly speak to the user’s current life context.
2) Continuing a recent reading ONLY if it is recent and coherent with the user’s week.
3) Other low-friction actions (check-in, conversation) as supportive follow-ups.

Use “Context” as your source of truth. Do not invent history.

REQUIREMENTS (HARD)
- 3–5 suggestions.
- At least TWO must be passage-focused when reading actions are enabled.
- Use ONLY action.type values from aff (enabled actions).
- EVERY suggestion must include ≥1 evidence_id from context.
- Subtitles must be EXACTLY one sentence.
- NEVER invent history, scripture text, emotions, or intent.

GROUNDING + TARGET (REQUIRED)
Each suggestion MUST include:
- grounding: one of
  reading_anchor | highlight_anchor | note_anchor | life_context | conversation_summary | plan_progress
- target_label: a specific named target
  (e.g., “Psalm 4:8”, “Parable of the Sower (Mark 4:1–20)”, “Going back to work Monday”)

LIFE CONTEXT
- life contains what the user explicitly shared (p = preview).
- When used:
  - The subtitle MUST reference the situation (paraphrased).
  - Cite the life evidence_id.

TONE
Warm, grounded, non-judgmental. Supportive, not directive.

FALLBACK
If specificity is insufficient:
- Suggest “One-minute reading” or “Quick check-in”.
- State uncertainty gently.

INPUT (CONTEXT)
You will receive a compact Context payload with short keys, best-effort fields:
- plan: { mode, len }
- life: [{ id, p }]
- mem: [{ id, p, k?, score? }]
- anchors: [{ id, ref, dur_s?, status?, t?, score? }]
- arts: [{ id, src:"note"|"hl", ref?, t?, summary?, tags? }]
- convos: [{ id, t?, p? }]
- aff: ["continue_reading","open_passage",...]
- user.first_name (optional)

If user.first_name exists, greet by name.
Return NDJSON only. No extra text.
`;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

export const getAllowedActionTypes = (ctx: unknown): string[] => {
  if (!isRecord(ctx)) return [];

  // Context-first shape: aff: string[]
  const aff = (ctx as any).aff;
  if (Array.isArray(aff) && aff.every((v) => typeof v === "string")) return [...aff];

  // Back-compat: old pack shape affordances.enabled_actions
  const enabled = (ctx as any).affordances?.enabled_actions;
  if (Array.isArray(enabled) && enabled.every((v: unknown) => typeof v === "string")) return [...enabled];

  return [];
};

export const getAllowedEvidenceIds = (ctx: unknown): string[] => {
  const ids = new Set<string>();

  if (isRecord(ctx)) {
    const collectArrayIds = (arr: unknown) => {
      if (!Array.isArray(arr)) return;
      for (const item of arr) {
        if (!isRecord(item)) continue;
        const id = (item as any).id;
        if (typeof id === "string" && id.trim()) ids.add(id);
      }
    };

    // Context-first shape
    collectArrayIds((ctx as any).life);
    collectArrayIds((ctx as any).mem);
    collectArrayIds((ctx as any).anchors);
    collectArrayIds((ctx as any).arts);
    collectArrayIds((ctx as any).convos);

    // Back-compat (old ActionsContextPack)
    const resumeEvidenceId = (ctx as any).resume?.evidence_id;
    if (typeof resumeEvidenceId === "string" && resumeEvidenceId.trim()) ids.add(resumeEvidenceId);
    for (const loop of ((ctx as any).open_loops ?? []) as any[]) {
      for (const id of (loop?.evidence_ids ?? []) as any[]) if (typeof id === "string" && id.trim()) ids.add(id);
    }
    for (const a of ((ctx as any).scripture_anchors ?? []) as any[]) {
      for (const id of (a?.evidence_ids ?? []) as any[]) if (typeof id === "string" && id.trim()) ids.add(id);
    }
    for (const item of (((ctx as any).life_context?.items ?? []) as any[])) {
      const id = item?.id;
      if (typeof id === "string" && id.trim()) ids.add(id);
    }
    for (const s of (((ctx as any).suggested_passages ?? []) as any[])) {
      for (const id of (s?.evidence_ids ?? []) as any[]) if (typeof id === "string" && id.trim()) ids.add(id);
    }
    for (const snippet of (((ctx as any).evidence_snippets ?? []) as any[])) {
      const id = snippet?.id;
      if (typeof id === "string" && id.trim()) ids.add(id);
    }
  }

  return [...ids];
};

const isSingleSentence = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const matches = trimmed.match(/[.!?](\s|$)/g) ?? [];
  // Allow 0 terminators (people often omit punctuation), but not multiple sentences.
  return matches.length <= 1;
};

export const greetingEventSchema = z.object({
  type: z.literal("greeting"),
  text: z.string().min(1).max(240),
});

export const suggestionEventSchema = (args: {
  allowedActionTypes: string[];
  allowedEvidenceIds: string[];
}) =>
  z
  .object({
    type: z.literal("suggestion"),
    rank: z.number().int().min(1).max(5),
    title: z.string().min(1).max(80),
    subtitle: z
      .string()
      .min(1)
      .max(200)
      .refine(isSingleSentence, "subtitle must be one sentence"),
    grounding: z.enum([
      "reading_anchor",
      "highlight_anchor",
      "note_anchor",
      "life_context",
      "conversation_summary",
      "plan_progress",
    ]),
    target_label: z.string().min(1).max(120),
    action: z.object({
      type: z
        .string()
        .min(1)
        .refine((t) => args.allowedActionTypes.includes(t), "invalid action.type"),
      params: z.record(z.string(), z.unknown()),
    }),
    evidence_ids: z
      .array(z.string().min(1))
      .min(1)
      .max(8)
      .refine(
        (ids) => ids.every((id) => args.allowedEvidenceIds.includes(id)),
        "evidence_ids must come from context"
      ),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((event, ctx) => {
    const anchorSchema = z
      .object({
        verse_start: z.number().int().min(1),
        verse_end: z.number().int().min(1),
      })
      .superRefine((a, aCtx) => {
        if (a.verse_end < a.verse_start) {
          aCtx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "anchor.verse_end must be >= verse_start",
          });
        }
      });

    const params = event.action.params as unknown;
    if (!isRecord(params)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "action.params must be an object",
        path: ["action", "params"],
      });
      return;
    }

    const refKey = params["ref_key"];
    const anchor = params["anchor"];

    const requireRefKey = () => {
      if (typeof refKey !== "string" || !refKey.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "ref_key is required",
          path: ["action", "params", "ref_key"],
        });
      }
    };

    const requireAnchor = () => {
      const parsed = anchorSchema.safeParse(anchor);
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "anchor must be {verse_start, verse_end}",
          path: ["action", "params", "anchor"],
        });
      }
    };

    switch (event.action.type) {
      case "continue_reading":
        requireRefKey();
        requireAnchor();
        return;
      case "open_passage":
        requireRefKey();
        if (anchor !== undefined && anchor !== null) requireAnchor();
        return;
      case "start_short_reading":
        requireRefKey();
        return;
      case "open_conversation_summary": {
        const artifactId = params["artifact_id"];
        if (typeof artifactId !== "string" || !artifactId.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "artifact_id is required",
            path: ["action", "params", "artifact_id"],
          });
        }
        return;
      }
      case "start_checkin":
      case "open_conversation":
        // No required params (currently).
        return;
      default:
        // Unknown action types are already blocked by allowedActionTypes.
        return;
    }
  });

export const doneEventSchema = z.object({
  type: z.literal("done"),
});

export const guideEventSchema = (args: {
  allowedActionTypes: string[];
  allowedEvidenceIds: string[];
}) =>
  z.union([greetingEventSchema, suggestionEventSchema(args), doneEventSchema]);

export type GreetingEvent = z.infer<typeof greetingEventSchema>;
export type DoneEvent = z.infer<typeof doneEventSchema>;
export type SuggestionEvent = z.infer<ReturnType<typeof suggestionEventSchema>>;
export type GuideEvent = GreetingEvent | SuggestionEvent | DoneEvent;


