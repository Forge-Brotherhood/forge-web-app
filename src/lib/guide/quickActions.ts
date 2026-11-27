import { z } from "zod";

/**
 * Quick actions over the reader's selection bar: the three best things to ask about the selected
 * verses, tools and questions ranked together (Explain is always shown first by the app and is
 * not among them). One small model call; cached by passage, so it only ever sees the reference and
 * the verse text, never anything about the reader.
 */

/** The tools a quick action may name: the guide block kinds the app can ask for by name. */
export const QUICK_ACTION_TOOLS = [
  "cross_refs",
  "word_study",
  "compare_translations",
  "context_callout",
  "map_card",
  "prayer_card",
] as const;

export type QuickActionTool = (typeof QUICK_ACTION_TOOLS)[number];

export type QuickAction =
  | { kind: "tool"; tool: QuickActionTool; label: string; prompt: string }
  | { kind: "question"; label: string; prompt: string };

export const QUICK_ACTION_COUNT = 3;
const MAX_LABEL = 40;
const MAX_QUESTION = 64;

/** Tools whose button always reads the same, whatever the model wrote. */
const FIXED_LABELS: Partial<Record<QuickActionTool, string>> = {
  cross_refs: "Cross references",
  compare_translations: "Compare translations",
};

const rawAction = z.object({
  kind: z.string(),
  tool: z.string().optional(),
  label: z.string(),
});

/** What a tool sends to the guide when tapped, built here so the model writes only labels. */
function toolPrompt(tool: QuickActionTool, label: string, reference: string): string {
  const detail = label.includes(":") ? label.slice(label.indexOf(":") + 1).trim() : "";
  switch (tool) {
    case "word_study":
      return detail ? `Do a word study on "${detail}" in ${reference}` : `Do a word study on ${reference}`;
    case "cross_refs":
      return `What other passages connect to ${reference}?`;
    case "compare_translations":
      return `Compare translations of ${reference}`;
    case "context_callout":
      return detail ? `What is the background to ${detail} in ${reference}?` : `What is the background to ${reference}?`;
    case "map_card":
      return `Show me on a map where ${reference} takes place`;
    case "prayer_card":
      return `Write a prayer from ${reference}`;
  }
}

export function quickActionsSystemPrompt(placeNames: string[]): string {
  return [
    "You choose the quick actions shown above a Bible reader when someone selects verses.",
    `Return the ${QUICK_ACTION_COUNT} most useful, best first.`,
    "Questions usually serve the reader best: lead with one unless a tool is plainly more useful for these exact verses. Include at least one question.",
    "",
    "Tools (use the id exactly), only when they add something specific to these verses, never as filler:",
    '- word_study: one word worth studying in the original language. Label "Word study: <word>".',
    "- cross_refs: only when these verses quote, echo or are echoed by other passages in a way worth tracing. Label \"Cross references\".",
    "- compare_translations: only where translations differ in a way that matters. Label \"Compare translations\".",
    '- context_callout: historical or cultural background that changes how it reads. Label "Context: <topic>", topic 1-4 words.',
    placeNames.length
      ? `- map_card: the places in these verses (${placeNames.slice(0, 6).join(", ")}). Label "Map: <places>".`
      : "- map_card: not available for these verses; never use it.",
    '- prayer_card: for a psalm, a prayer, or verses that invite praying them. Label "Pray this psalm" or "Pray these verses".',
    "",
    "Questions: what a thoughtful reader is likely wondering about these verses.",
    "- Short and specific to the words of the text, never generic (not \"What does this mean?\").",
    "- No yes/no questions, no personal application, no jargon.",
    "",
    `Labels: short. At most ${MAX_LABEL - 8} characters for a tool, ${MAX_QUESTION - 16} for a question (the question is its own label).`,
    "",
    '"kind" is always "tool" or "question"; a tool names its id in "tool".',
    'Output JSON only: {"actions":[{"kind":"question","label":"How am I led by the Spirit?"},{"kind":"tool","tool":"word_study","label":"Word study: Abba"},{"kind":"tool","tool":"cross_refs","label":"Cross references"}]}',
  ].join("\n");
}

/**
 * A question always shows among the first two: the row is narrow, and a question ranked behind two
 * tool chips sits off the screen's edge.
 */
function questionUpFront(actions: QuickAction[]): QuickAction[] {
  const first = actions.findIndex((a) => a.kind === "question");
  if (first < 2) return actions;
  const out = [...actions];
  const [question] = out.splice(first, 1);
  out.splice(1, 0, question);
  return out;
}

/**
 * The model's answer, cleaned: known tools only (a map only where there are places), labels that
 * fit their buttons, no repeats, at most three. Anything malformed is dropped rather than shown.
 */
export function parseQuickActions(content: string, opts: { hasPlaces: boolean; reference: string }): QuickAction[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const list = (parsed as { actions?: unknown })?.actions;
  if (!Array.isArray(list)) return [];

  const out: QuickAction[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const r = rawAction.safeParse(item);
    if (!r.success) continue;
    const written = r.data.label.trim();
    if (!written) continue;
    // A tool's id sometimes comes as its kind: {"kind":"cross_refs"}.
    const toolId = r.data.kind === "tool" ? r.data.tool : r.data.kind;
    const tool = QUICK_ACTION_TOOLS.find((t) => t === toolId);
    if (tool) {
      if (tool === "map_card" && !opts.hasPlaces) continue;
      const label = FIXED_LABELS[tool] ?? written;
      if (label.length > MAX_LABEL || seen.has(tool)) continue;
      seen.add(tool);
      out.push({ kind: "tool", tool, label, prompt: toolPrompt(tool, label, opts.reference) });
    } else if (r.data.kind === "question") {
      const label = written;
      if (label.length > MAX_QUESTION || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      out.push({ kind: "question", label, prompt: label });
    }
    if (out.length === QUICK_ACTION_COUNT) break;
  }
  return questionUpFront(out);
}
