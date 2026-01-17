export type Topic =
  | "work"
  | "anxiety"
  | "peace"
  | "rest"
  | "guidance"
  | "steadfastness"
  | "identity"
  | "relationships"
  | "temptation"
  | "gratitude"
  | "grief"
  | "forgiveness"
  | "hope"
  | "other";

type TopicRuleSet = {
  strong: string[];
  medium: string[];
  weak: string[];
  patterns?: RegExp[];
};

const TOPIC_RULES: Record<Topic, TopicRuleSet> = {
  work: {
    strong: ["work", "job", "office", "boss", "coworker", "deadline", "interview", "promotion"],
    medium: ["career", "meeting", "project", "performance", "manager"],
    weak: ["monday", "back to work", "commute"],
    patterns: [/back to work/i, /\b(start|starting)\b.*\bwork\b/i],
  },
  anxiety: {
    strong: ["anxiety", "anxious", "panic", "panicking"],
    medium: ["worry", "worried", "nervous", "overwhelmed", "fear"],
    weak: ["uncertain", "pressure", "stress"],
  },
  peace: {
    strong: ["peace", "calm", "stillness"],
    medium: ["restful", "settled", "steady", "quiet"],
    weak: ["ease"],
    patterns: [/\bpeace\b.*\bheart\b/i],
  },
  rest: {
    strong: ["tired", "exhausted", "burnout", "burned out", "sleep", "insomnia"],
    medium: ["rest", "weary", "fatigue"],
    weak: ["busy", "drained"],
  },
  guidance: {
    strong: ["guidance", "direction", "wisdom", "discernment"],
    medium: ["decision", "choose", "clarity", "next step"],
    weak: ["planning"],
  },
  steadfastness: {
    strong: ["steadfast", "steadfastness", "consistent", "discipline"],
    medium: ["habit", "routine", "faithful", "persevere", "endurance"],
    weak: ["new year", "everyday", "daily"],
  },
  identity: {
    strong: ["identity", "worth", "insecure", "insecurity"],
    medium: ["shame", "confidence", "self doubt", "comparison"],
    weak: ["belonging"],
  },
  relationships: {
    strong: ["marriage", "spouse", "wife", "husband", "kids", "family", "friend", "relationship"],
    medium: ["conflict", "argument", "forgive", "reconcile"],
    weak: ["communication"],
  },
  temptation: {
    strong: ["lust", "porn", "temptation", "addiction"],
    medium: ["habit", "impulse", "urge"],
    weak: ["struggle"],
  },
  gratitude: {
    strong: ["gratitude", "thankful", "thanks", "praise"],
    medium: ["joy", "rejoice"],
    weak: ["blessed"],
  },
  grief: {
    strong: ["grief", "mourning", "loss", "funeral"],
    medium: ["sad", "heartbroken", "tears"],
    weak: ["heavy"],
  },
  forgiveness: {
    strong: ["forgiveness", "forgive", "resent", "bitterness"],
    medium: ["reconcile", "apology"],
    weak: ["hurt"],
  },
  hope: {
    strong: ["hope", "hoping", "future", "new beginning"],
    medium: ["encouragement", "strength"],
    weak: ["new year"],
  },
  other: { strong: [], medium: [], weak: [] },
};

const TOPIC_PASSAGES: Record<Topic, string[]> = {
  work: ["COL:3", "PRO:16", "JAS:1", "PSA:90", "1TH:5"],
  anxiety: ["MAT:6", "PHP:4", "1PE:5", "PSA:56", "ISA:41"],
  peace: ["PHP:4", "JHN:14", "ISA:26", "PSA:4", "PSA:23"],
  rest: ["MAT:11", "PSA:23", "HEB:4", "PSA:127", "EXO:33"],
  guidance: ["PRO:3", "JAS:1", "PSA:32", "PSA:119", "ROM:12"],
  steadfastness: ["JAS:1", "HEB:12", "GAL:6", "PHP:3", "2TI:1"],
  identity: ["ROM:8", "EPH:1", "1PE:2", "PSA:139", "2CO:5"],
  relationships: ["EPH:4", "COL:3", "1CO:13", "MAT:18", "ROM:12"],
  temptation: ["1CO:10", "JAS:1", "PSA:101", "MAT:26", "ROM:6"],
  gratitude: ["PSA:103", "1TH:5", "PHP:4", "COL:3", "PSA:95"],
  grief: ["PSA:34", "MAT:5", "2CO:1", "REV:21", "JHN:11"],
  forgiveness: ["MAT:6", "MAT:18", "EPH:4", "COL:3", "PSA:103"],
  hope: ["ROM:15", "ISA:40", "LAM:3", "PSA:42", "2CO:4"],
  other: ["PSA:23", "PHP:4", "PRO:3", "ROM:8", "MAT:11"],
};

export type LifeContextSnippetSource = {
  id: string;
  type: string; // weekly_intention | prayer_topic | season | schedule | goal | ...
  created_at_utc: string;
  snippet: string;
};

export type ContextTarget = {
  topic: Topic;
  situation_snippet: string;
  suggested_refs: Array<{ ref_key: string; why: string; evidence_ids: string[] }>;
};

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasWord = (normalizedHaystack: string, normalizedNeedle: string): boolean => {
  if (!normalizedNeedle) return false;
  if (normalizedNeedle.includes(" ")) return normalizedHaystack.includes(normalizedNeedle);
  const re = new RegExp(`(?:^|\\s)${escapeRegExp(normalizedNeedle)}(?:$|\\s)`, "i");
  return re.test(normalizedHaystack);
};

const daysSince = (now: Date, tsUtc: string): number => {
  const t = new Date(tsUtc);
  if (!Number.isFinite(t.getTime())) return 999;
  return Math.max(0, Math.floor((now.getTime() - t.getTime()) / 86400000));
};

const sourceBoost = (sourceType: string): number => {
  if (sourceType === "weekly_intention") return 2;
  if (sourceType === "prayer_topic") return 1;
  if (sourceType === "goal" || sourceType === "season") return 0.5;
  if (sourceType === "schedule") return 0.5;
  return 0;
};

const recencyBoost = (days: number): number => (days < 7 ? 0.5 : 0);

const pickSituationSnippet = (candidates: Array<{ snippet: string }>, maxChars: number): string => {
  const sorted = [...candidates].sort((a, b) => b.snippet.length - a.snippet.length);
  const best = sorted[0]?.snippet ?? "";
  if (best.length <= maxChars) return best;
  return `${best.slice(0, maxChars - 1).trimEnd()}…`;
};

const whySentenceFor = (topic: Topic, situationSnippet: string): string => {
  const base = `Given ${situationSnippet ? `“${situationSnippet}”` : "what you’re carrying right now"},`;
  switch (topic) {
    case "work":
      return `${base} this passage can help you work with steadiness and purpose.`;
    case "anxiety":
      return `${base} this passage can help you practice trust when anxiety rises.`;
    case "peace":
      return `${base} this passage can help you pursue steady peace in anxious moments.`;
    case "rest":
      return `${base} this passage can help you receive rest when you feel worn down.`;
    case "guidance":
      return `${base} this passage can help you seek wisdom for your next step.`;
    case "steadfastness":
      return `${base} this passage can help you build steady endurance over time.`;
    case "identity":
      return `${base} this passage can help you remember your worth and belonging.`;
    case "relationships":
      return `${base} this passage can help you pursue patience and repair in relationships.`;
    case "temptation":
      return `${base} this passage can help you resist temptation with a clear next step.`;
    case "gratitude":
      return `${base} this passage can help you practice gratitude with clarity.`;
    case "grief":
      return `${base} this passage can help you grieve with honesty and hope.`;
    case "forgiveness":
      return `${base} this passage can help you move toward forgiveness without minimizing harm.`;
    case "hope":
      return `${base} this passage can help you hold onto hope for what’s ahead.`;
    default:
      return `${base} this passage can help you take a grounded next step.`;
  }
};

export function buildContextTargets(params: {
  sources: LifeContextSnippetSource[];
  now: Date;
  maxTopics?: number;
  maxRefsPerTopic?: number;
  situationSnippetMaxChars?: number;
}): ContextTarget[] {
  const maxTopics = params.maxTopics ?? 3;
  const maxRefsPerTopic = params.maxRefsPerTopic ?? 3;
  const situationSnippetMaxChars = params.situationSnippetMaxChars ?? 120;

  const scoredByTopic: Record<Topic, { score: number; topSourceIds: string[]; snippets: string[] }> =
    Object.fromEntries(
      (Object.keys(TOPIC_RULES) as Topic[]).map((t) => [t, { score: 0, topSourceIds: [], snippets: [] }])
    ) as any;

  for (const source of params.sources) {
    const raw = source.snippet ?? "";
    if (!raw.trim()) continue;
    const normalized = normalize(raw);
    const days = daysSince(params.now, source.created_at_utc);
    const boost = sourceBoost(source.type) + recencyBoost(days);

    for (const topic of Object.keys(TOPIC_RULES) as Topic[]) {
      if (topic === "other") continue;
      const rules = TOPIC_RULES[topic];

      const strongHits = rules.strong.filter((k) => hasWord(normalized, normalize(k))).length;
      const mediumHits = rules.medium.filter((k) => hasWord(normalized, normalize(k))).length;
      const weakHits = rules.weak.filter((k) => hasWord(normalized, normalize(k))).length;
      const patternHit = (rules.patterns ?? []).some((re) => re.test(raw));

      const rawScore =
        Math.min(6, strongHits) * 3 +
        Math.min(6, mediumHits) * 2 +
        Math.min(6, weakHits) * 1 +
        (patternHit ? 2 : 0);

      if (rawScore <= 0) continue;

      const total = rawScore + boost;
      const agg = scoredByTopic[topic];
      agg.score += total;
      agg.snippets.push(raw);
      agg.topSourceIds.push(source.id);
    }
  }

  const ranked = (Object.keys(TOPIC_RULES) as Topic[])
    .filter((t) => t !== "other")
    .map((t) => ({ topic: t, score: scoredByTopic[t].score }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTopics);

  const topics: Topic[] = ranked.length ? ranked.map((r) => r.topic) : ["other"];

  const targets: ContextTarget[] = [];
  for (const topic of topics) {
    const agg = scoredByTopic[topic];
    const uniqueEvidenceIds = Array.from(new Set(agg.topSourceIds)).slice(0, 2);
    const situationSnippet = pickSituationSnippet(
      agg.snippets.map((s) => ({ snippet: s })),
      situationSnippetMaxChars
    );
    const refs = TOPIC_PASSAGES[topic] ?? TOPIC_PASSAGES.other;
    const suggested_refs = refs.slice(0, maxRefsPerTopic).map((ref_key) => ({
      ref_key,
      why: whySentenceFor(topic, situationSnippet),
      evidence_ids: uniqueEvidenceIds.length ? uniqueEvidenceIds : [],
    }));

    targets.push({
      topic,
      situation_snippet: situationSnippet,
      suggested_refs,
    });
  }

  return targets;
}

export function buildContextPassageLoops(params: {
  contextTargets: ContextTarget[];
  enabledActions: string[];
}): Array<{
  type: "context_passage";
  priority: number;
  ref_key: string;
  anchor: null;
  artifact_id: null;
  evidence_ids: string[];
  projected_action: { type: "open_passage"; params: { ref_key: string } } | null;
}> {
  const canOpen = params.enabledActions.includes("open_passage");
  const loops: Array<{
    type: "context_passage";
    priority: number;
    ref_key: string;
    anchor: null;
    artifact_id: null;
    evidence_ids: string[];
    projected_action: { type: "open_passage"; params: { ref_key: string } } | null;
  }> = [];

  for (const t of params.contextTargets.slice(0, 2)) {
    const first = t.suggested_refs[0];
    if (!first?.ref_key) continue;
    const evidenceId = first.evidence_ids?.[0] ?? null;
    loops.push({
      type: "context_passage",
      priority: 0.93,
      ref_key: first.ref_key,
      anchor: null,
      artifact_id: null,
      evidence_ids: evidenceId ? [evidenceId] : [],
      projected_action: canOpen ? { type: "open_passage", params: { ref_key: first.ref_key } } : null,
    });
  }

  return loops;
}


