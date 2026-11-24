import { looksInstructional, looksSensitive } from "@/lib/chat/tools/contextTools";
import { GOAL_CATEGORIES, GOAL_SHAPES, type GoalCategory, type GoalShape } from "@/lib/goals/goalTypes";

/**
 * Goals a finished conversation points to without the user having stated them. The app offers each
 * one as a suggestion; nothing happens until the user says yes. Nothing is stored here.
 */

export type GoalCandidate = {
  title: string;
  why?: string;
  shape: GoalShape;
  category: GoalCategory;
  /** Indices into the `messages` the app sent: what the goal came from. */
  evidence: number[];
};

type Message = { role: "user" | "assistant"; content: string };

const MAX_CANDIDATES = 2;
/** The model reads the end of a long conversation. Indices still point into the full list. */
const MAX_MESSAGES_READ = 60;
const MAX_MESSAGE_CHARS = 1500;

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The same goal in other words is not caught, but the same words, or one inside the other, are. */
const sameGoal = (a: string, b: string): boolean => {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 8 && long.includes(short);
};

/**
 * Keeps only candidates that are well formed, cite real messages (at least one of them the user's
 * own), pass the memory-note checks, and don't repeat an active, declined or earlier candidate.
 */
export function filterGoalCandidates(args: {
  raw: unknown;
  messages: Message[];
  activeTitles: string[];
  declinedTitles: string[];
}): GoalCandidate[] {
  if (!Array.isArray(args.raw)) return [];
  const taken = [...args.activeTitles, ...args.declinedTitles];
  const out: GoalCandidate[] = [];

  for (const item of args.raw) {
    if (out.length >= MAX_CANDIDATES) break;
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;

    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    if (!title || title.length > 120) continue;
    const why = typeof rec.why === "string" ? rec.why.trim() : "";
    if (why.length > 300) continue;
    if ([title, why].some((t) => looksSensitive(t) || looksInstructional(t))) continue;

    const shape = GOAL_SHAPES.find((s) => s === rec.shape);
    const category = GOAL_CATEGORIES.find((c) => c === rec.category);
    if (!shape || !category) continue;

    const evidence = Array.isArray(rec.evidence)
      ? [
          ...new Set(
            rec.evidence.filter(
              (n): n is number =>
                typeof n === "number" &&
                Number.isInteger(n) &&
                n >= 0 &&
                n < args.messages.length &&
                args.messages[n].content.trim().length > 0
            )
          ),
        ].sort((a, b) => a - b)
      : [];
    if (!evidence.some((n) => args.messages[n].role === "user")) continue;

    if (taken.some((t) => sameGoal(t, title)) || out.some((c) => sameGoal(c.title, title))) continue;

    out.push({ title, ...(why ? { why } : {}), shape, category, evidence });
  }
  return out;
}

const SYSTEM_PROMPT = `
You read a finished conversation between a user and a Bible-app guide and find goals the user is working toward in their life with God, which they did not state outright. Return JSON only.

Rules (hard):
- A goal needs real evidence in what the USER said: they came back to a subject, or said they wish they did something, or described a change they want. A single passing remark is not enough.
- Do not infer goals from what the assistant said. Do not diagnose or label the user.
- Return at most 2 goals, and return an empty list when nothing clearly fits. Most conversations have none.
- Never return a goal the user already has or has declined (listed below), or the same goal in other words.
- title: the goal in the user's own words where you can, under 120 characters, like "Read the Bible in a year" or "Pray every morning".
- why: the user's own reason, only if they gave one. Otherwise leave it out.
- shape: "finish" (get through something by a date), "practice" (keep a rhythm), "learn" (study a subject) or "grow" (a change in who they are, such as overcoming a sin or habit).
- category: one of ${GOAL_CATEGORIES.join(", ")}.
- evidence: the indices of the messages the goal comes from, exactly as numbered below. At least one must be a user message.
`.trim();

const buildPrompt = (messages: Message[], activeTitles: string[], declinedTitles: string[]): string => {
  const start = Math.max(0, messages.length - MAX_MESSAGES_READ);
  const lines = messages
    .map((m, i) => ({ m, i }))
    .slice(start)
    .filter(({ m }) => m.content.trim().length > 0)
    .map(({ m, i }) => `[${i}] ${m.role.toUpperCase()}: ${m.content.slice(0, MAX_MESSAGE_CHARS)}`);
  return [
    "CONVERSATION (each message is numbered):",
    ...lines,
    "",
    `Goals the user already has: ${JSON.stringify(activeTitles)}`,
    `Goals the user has declined: ${JSON.stringify(declinedTitles)}`,
    "",
    'Return {"goals": [{"title": string, "why": string, "shape": string, "category": string, "evidence": number[]}]}',
  ].join("\n");
};

/** Returns no candidates rather than failing: a missing suggestion costs the user nothing. */
export async function generateGoalCandidates(args: {
  messages: Message[];
  activeTitles: string[];
  declinedTitles: string[];
}): Promise<GoalCandidate[]> {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) return [];
  if (!args.messages.some((m) => m.role === "user" && m.content.trim())) return [];

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiApiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        store: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(args.messages, args.activeTitles, args.declinedTitles) },
        ],
        max_tokens: 600,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) return [];

    const content = ((await response.json()) as any)?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return [];
    return filterGoalCandidates({
      raw: (JSON.parse(content) as { goals?: unknown }).goals,
      messages: args.messages,
      activeTitles: args.activeTitles,
      declinedTitles: args.declinedTitles,
    });
  } catch {
    return [];
  }
}
