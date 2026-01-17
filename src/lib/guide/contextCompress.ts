import { BOOK_NAME_TO_CODE } from "@/lib/bible/bookCodes";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  !!value && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const truncate = (value: string, maxChars: number): string =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars)}…`;

const previewMaxChars = 160;

const normalizeBookNameKey = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ");

const parseLooseRef = (
  input: string
): { bookCode: string; chapter: number; verseStart?: number; verseEnd?: number } | null => {
  // Matches: "Psalms 51:9", "1 John 2:1-2", "John 6", "Song of Songs 1:1"
  const m = input
    .trim()
    .match(/^(\d?\s*[A-Za-z][A-Za-z\s]+?)\s+(\d{1,3})(?::(\d{1,3})(?:-(\d{1,3}))?)?$/);
  if (!m) return null;
  const bookName = normalizeBookNameKey(m[1] ?? "");
  const chapter = Number(m[2]);
  if (!Number.isFinite(chapter)) return null;

  const bookCode = BOOK_NAME_TO_CODE[bookName];
  if (!bookCode) return null;

  const verseStart = m[3] ? Number(m[3]) : undefined;
  const verseEnd = m[4] ? Number(m[4]) : undefined;
  return { bookCode, chapter, ...(verseStart ? { verseStart } : {}), ...(verseEnd ? { verseEnd } : {}) };
};

type ParsedRef = { bookCode: string; chapter: number; verseStart?: number; verseEnd?: number };

const parseCompactRefString = (input: string): ParsedRef | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // If multiple ranges are present (e.g., "ROM 8:1-6, 8:22-26"), parse the first range.
  const firstPart = trimmed.split(",")[0]?.trim() ?? trimmed;

  // Accept: "JHN 6", "JHN 6:1", "JHN 6:1-5"
  const m = firstPart.match(/^([1-3]?[A-Z]{2,3})\s+(\d{1,3})(?::(\d{1,3})(?:-(\d{1,3}))?)?$/);
  if (!m) return null;
  const bookCode = m[1]!;
  const chapter = Number(m[2]!);
  if (!Number.isFinite(chapter)) return null;
  const verseStart = m[3] ? Number(m[3]) : undefined;
  const verseEnd = m[4] ? Number(m[4]) : undefined;
  return {
    bookCode,
    chapter,
    ...(verseStart && Number.isFinite(verseStart) ? { verseStart } : {}),
    ...(verseEnd && Number.isFinite(verseEnd) ? { verseEnd } : {}),
  };
};

const refsMatch = (a: ParsedRef, b: ParsedRef): boolean => {
  if (a.bookCode !== b.bookCode) return false;
  if (a.chapter !== b.chapter) return false;
  if (!a.verseStart || !b.verseStart) return true; // chapter-level match if either lacks verse

  const aEnd = a.verseEnd ?? a.verseStart;
  const bEnd = b.verseEnd ?? b.verseStart;
  return a.verseStart <= bEnd && b.verseStart <= aEnd;
};

const recencyFromTime = (t: string | undefined): number => {
  if (!t) return 0;
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return 0;
  const ageDays = (Date.now() - ms) / (1000 * 60 * 60 * 24);
  if (ageDays < 1) return 1.0;
  if (ageDays < 7) return 0.9;
  if (ageDays < 30) return 0.7;
  if (ageDays < 90) return 0.5;
  return 0.3;
};

const formatRef = (args: {
  bookCode: string;
  chapter: number;
  verseStart?: number;
  verseEnd?: number;
}): string => {
  const { bookCode, chapter, verseStart, verseEnd } = args;
  if (!verseStart) return `${bookCode} ${chapter}`;
  if (!verseEnd || verseEnd === verseStart) return `${bookCode} ${chapter}:${verseStart}`;
  return `${bookCode} ${chapter}:${verseStart}-${verseEnd}`;
};

export type ContextPack = {
  plan?: { mode?: string; len?: string };
  life?: Array<{ id: string; p?: string }>;
  mem?: Array<{ id: string; p?: string; k?: string; score?: number }>;
  anchors?: Array<{ id: string; ref?: string; dur_s?: number; status?: string; t?: string; score?: number }>;
  arts?: Array<{ id: string; src?: "note" | "hl"; ref?: string; t?: string; summary?: string; tags?: string[] }>;
  convos?: Array<{ id: string; t?: string; p?: string }>;
  aff?: string[];
};

type RawCandidate = {
  id: string;
  source: string;
  preview?: string;
  metadata?: UnknownRecord;
  features?: UnknownRecord;
};

type RawContextCandidatesBundle = {
  plan?: unknown;
  candidates?: unknown;
  bySourceCounts?: unknown;
};

const getPlanCompact = (plan: unknown): { mode?: string; len?: string } | undefined => {
  if (!isRecord(plan)) return undefined;
  const response = (plan as any).response;
  if (!isRecord(response)) return undefined;
  const mode = asString((response as any).responseMode) ?? undefined;
  const len = asString((response as any).lengthTarget) ?? undefined;
  if (!mode && !len) return undefined;
  return { ...(mode ? { mode } : {}), ...(len ? { len } : {}) };
};

const getCreatedAt = (candidate: RawCandidate): string | null => {
  const t1 = asString(candidate.features?.createdAt);
  if (t1) return t1;
  const t2 = asString(candidate.metadata?.createdAt);
  if (t2) return t2;
  const t3 = asString(candidate.metadata?.endedAt);
  if (t3) return t3;
  return null;
};

const getRecencyScore = (candidate: RawCandidate): number | null => asNumber(candidate.features?.recencyScore);

const compressLife = (candidates: RawCandidate[]) =>
  candidates
    .filter((c) => c.source === "life_context")
    .map((c) => ({ id: c.id, p: c.preview ? truncate(c.preview, previewMaxChars) : undefined }))
    .filter((x) => !!x.p);

const compressMem = (candidates: RawCandidate[]) =>
  candidates
    .filter((c) => c.source === "user_memory")
    .map((c) => {
      const memoryType = asString(c.metadata?.memoryType);
      const value = c.metadata?.value;
      const theme =
        isRecord(value) && typeof (value as any).theme === "string" && (value as any).theme.trim()
          ? (value as any).theme.trim()
          : null;
      const strength = asNumber(c.metadata?.strength);
      return {
        id: c.id,
        p: c.preview ? truncate(c.preview, previewMaxChars) : undefined,
        ...(theme ? { k: theme } : memoryType ? { k: memoryType } : {}),
        ...(strength != null ? { score: strength } : {}),
      };
    })
    .filter((x) => !!x.p);

type ReadingSessionKey = `${string}:${number}:${string}`; // bookId:chapter:localDate

const compressReadingSessionsToAnchors = (candidates: RawCandidate[]) => {
  const sessions = candidates.filter((c) => c.source === "bible_reading_session");

  type Session = {
    raw: RawCandidate;
    bookId: string | null;
    bookName: string | null;
    chapter: number | null;
    readRanges: string[] | null;
    localDate: string | null;
    endedAt: string | null;
    endedAtMs: number | null;
    durationSeconds: number | null;
  };

  const parsed: Session[] = sessions
    .map((c) => {
      const startRef = isRecord(c.metadata?.startRef) ? (c.metadata?.startRef as UnknownRecord) : null;
      const endRef = isRecord(c.metadata?.endRef) ? (c.metadata?.endRef as UnknownRecord) : null;

      const bookId = asString((startRef as any)?.bookId) ?? asString((endRef as any)?.bookId);
      const bookName = asString((startRef as any)?.book) ?? asString((endRef as any)?.book) ?? null;
      const chapter = asNumber((startRef as any)?.chapter) ?? asNumber((endRef as any)?.chapter);
      const readRangesRaw = (c.metadata as any)?.readRanges;
      const readRanges =
        Array.isArray(readRangesRaw) && readRangesRaw.every((v) => typeof v === "string")
          ? (readRangesRaw as string[])
          : null;
      const localDate = asString((c.metadata as any)?.localDate) ?? null;
      const endedAt = asString(c.metadata?.endedAt) ?? asString(c.features?.createdAt);
      const endedAtMs = endedAt ? Date.parse(endedAt) : null;
      const durationSeconds = asNumber(c.metadata?.durationSeconds);

      return {
        raw: c,
        bookId,
        bookName,
        chapter: chapter != null ? Math.floor(chapter) : null,
        readRanges,
        localDate,
        endedAt,
        endedAtMs: endedAtMs != null && Number.isFinite(endedAtMs) ? endedAtMs : null,
        durationSeconds: durationSeconds != null ? Math.floor(durationSeconds) : null,
      };
    })
    // Ignore ultra-short sessions (scroll jitter / instrumentation noise)
    .filter((s) => s.durationSeconds == null || s.durationSeconds >= 15);

  const byKey = new Map<ReadingSessionKey, Session[]>();
  for (const s of parsed) {
    if (!s.bookId || s.chapter == null) continue;
    const keyLocalDate =
      s.localDate ??
      (s.endedAt && /^\d{4}-\d{2}-\d{2}/.test(s.endedAt) ? s.endedAt.slice(0, 10) : null) ??
      "unknown";
    const key = `${s.bookId}:${s.chapter}:${keyLocalDate}` as ReadingSessionKey;
    const list = byKey.get(key) ?? [];
    list.push(s);
    byKey.set(key, list);
  }

  const tenMinMs = 10 * 60 * 1000;
  const anchors: Array<{ id: string; ref?: string; dur_s?: number; status?: string; t?: string; score?: number }> =
    [];

  for (const group of byKey.values()) {
    const ordered = group.slice().sort((a, b) => (b.endedAtMs ?? 0) - (a.endedAtMs ?? 0));

    // Build time-window clusters (most recent first).
    const clusters: Session[][] = [];
    for (const s of ordered) {
      const lastCluster = clusters[clusters.length - 1];
      if (!lastCluster?.length) {
        clusters.push([s]);
        continue;
      }
      const anchorMs = lastCluster[0]?.endedAtMs ?? null;
      if (anchorMs != null && s.endedAtMs != null && Math.abs(anchorMs - s.endedAtMs) <= tenMinMs) {
        lastCluster.push(s);
        continue;
      }
      clusters.push([s]);
    }

    // For each cluster, keep: longest duration + most recent (if different)
    for (const cluster of clusters) {
      if (!cluster.length) continue;
      const mostRecent = cluster[0]!;
      const longest = cluster
        .slice()
        .sort((a, b) => (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0))[0]!;

      const picked = new Map<string, Session>();
      picked.set(mostRecent.raw.id, mostRecent);
      picked.set(longest.raw.id, longest);

      for (const s of picked.values()) {
        if (!s.bookId || s.chapter == null) continue;
        const ref = (() => {
          const bookCode = s.bookId;
          if (s.readRanges && s.readRanges.length > 0) {
            return `${bookCode} ${s.readRanges.join(", ")}`;
          }
          return formatRef({ bookCode, chapter: s.chapter });
        })();
        anchors.push({
          id: s.raw.id,
          ref,
          ...(s.durationSeconds != null ? { dur_s: s.durationSeconds } : {}),
          ...(() => {
            const raw = (s.raw.metadata as any)?.completionStatus;
            const status =
              typeof raw === "string"
                ? raw
                : raw && typeof raw === "object" && !Array.isArray(raw) && "status" in raw
                  ? String((raw as any).status)
                  : null;
            return status ? { status } : {};
          })(),
          ...(s.endedAt ? { t: s.endedAt } : {}),
          ...(getRecencyScore(s.raw) != null ? { score: getRecencyScore(s.raw)! } : {}),
        });
      }
    }
  }

  // Deterministic order: most recent first.
  return anchors.slice().sort((a, b) => Date.parse(b.t ?? "") - Date.parse(a.t ?? "")).slice(0, 24);
};

const compressArtifacts = (candidates: RawCandidate[]) => {
  const artifacts = candidates.filter((c) => c.source === "artifact");

  const arts: Array<{ id: string; src?: "note" | "hl"; ref?: string; t?: string; summary?: string; tags?: string[] }> =
    [];
  const convos: Array<{ id: string; t?: string; p?: string }> = [];

  for (const c of artifacts) {
    const artifactType = asString(c.metadata?.artifactType) ?? "";
    const t = getCreatedAt(c) ?? undefined;

    if (artifactType === "conversation_session_summary") {
      convos.push({
        id: c.id,
        ...(t ? { t } : {}),
        ...(c.preview ? { p: truncate(c.preview, previewMaxChars) } : {}),
      });
      continue;
    }

    if (artifactType === "verse_note" || artifactType === "verse_highlight") {
      const scriptureRefs = c.metadata?.scriptureRefs;
      const firstRefText =
        Array.isArray(scriptureRefs) && typeof scriptureRefs[0] === "string" ? (scriptureRefs[0] as string) : null;
      const parsedRef = firstRefText ? parseLooseRef(firstRefText) : null;
      const ref = parsedRef ? formatRef(parsedRef) : firstRefText ? truncate(firstRefText, 48) : undefined;

      const noteSummary = asString(c.metadata?.noteSummary);
      const noteTagsRaw = c.metadata?.noteTags;
      const noteTags =
        Array.isArray(noteTagsRaw) && noteTagsRaw.every((v) => typeof v === "string")
          ? (noteTagsRaw as string[]).filter(Boolean).slice(0, 3)
          : null;

      arts.push({
        id: c.id,
        src: artifactType === "verse_note" ? "note" : "hl",
        ...(ref ? { ref } : {}),
        ...(t ? { t } : {}),
        ...(noteSummary ? { summary: truncate(noteSummary, previewMaxChars) } : {}),
        ...(noteTags && noteTags.length ? { tags: noteTags } : {}),
      });
    }
  }

  const byTimeDesc = <T extends { t?: string }>(items: T[]) =>
    items
      .slice()
      .sort((a, b) => Date.parse(b.t ?? "") - Date.parse(a.t ?? ""))
      .filter((x) => x.t || (x as any).p || (x as any).ref);

  return {
    arts: byTimeDesc(arts).slice(0, 24),
    convos: byTimeDesc(convos).slice(0, 10),
  };
};

const selectPrimaryAnchors = (
  anchors: Array<{ id: string; ref?: string; dur_s?: number; status?: string; t?: string; score?: number }>
): Array<{ id: string; ref?: string; dur_s?: number; status?: string; t?: string; score?: number }> => {
  const K_PRIMARY = 9;
  const LONG_SESSION_SECONDS = 5 * 60;

  const scoreAnchor = (a: (typeof anchors)[number]) => {
    const status = (a.status ?? "").toLowerCase();
    const isResumeLike = status.includes("in_progress") || status.includes("continue") || status.includes("resume");
    const isLong = (a.dur_s ?? 0) >= LONG_SESSION_SECONDS;
    const typeWeight = isResumeLike ? 1.4 : isLong ? 1.1 : 0.9;
    const recency = a.score ?? recencyFromTime(a.t);
    const durBonus = a.dur_s != null ? Math.min(a.dur_s, 15 * 60) / (15 * 60) * 0.35 : 0;
    return typeWeight + recency + durBonus;
  };

  return anchors
    .slice()
    .map((a) => ({ a, s: scoreAnchor(a) }))
    .sort((x, y) => {
      if (y.s !== x.s) return y.s - x.s;
      const yt = Date.parse(y.a.t ?? "");
      const xt = Date.parse(x.a.t ?? "");
      if (Number.isFinite(yt) && Number.isFinite(xt) && yt !== xt) return yt - xt;
      return x.a.id.localeCompare(y.a.id);
    })
    .slice(0, K_PRIMARY)
    .map((x) => x.a);
};

const attachSupportingArts = (args: {
  anchors: Array<{ id: string; ref?: string; dur_s?: number; status?: string; t?: string; score?: number }>;
  arts: Array<{ id: string; src?: "note" | "hl"; ref?: string; t?: string; summary?: string; tags?: string[] }>;
}): {
  anchors: Array<{ id: string; ref?: string; dur_s?: number; status?: string; t?: string; score?: number }>;
  arts: Array<{ id: string; src?: "note" | "hl"; ref?: string; t?: string; summary?: string; tags?: string[] }>;
} => {
  const TOTAL_CAP = 12;
  const SUPPORT_CAP = 6;

  const anchorsWithParsed = args.anchors
    .map((a) => ({ a, parsed: a.ref ? parseCompactRefString(a.ref) : null }))
    .filter((x) => !!x.parsed);

  const scoreSupport = (art: (typeof args.arts)[number]) => {
    const srcWeight = art.src === "note" ? 1.2 : 0.9;
    const summaryBonus = art.src === "note" && art.summary ? 0.4 : 0;
    const tagsBonus = art.tags && art.tags.length > 0 ? 0.1 : 0;
    const recency = recencyFromTime(art.t);
    return srcWeight + summaryBonus + tagsBonus + recency;
  };

  // Assign each art to the best-matching primary anchor (avoid duplicates).
  const artAssignments = new Map<string, { anchorId: string; score: number }>();

  for (const art of args.arts) {
    const parsedArt = art.ref ? parseCompactRefString(art.ref) : null;
    if (!parsedArt) continue;

    let best: { anchorId: string; score: number } | null = null;
    for (const { a: anchor, parsed } of anchorsWithParsed) {
      if (!parsed) continue;
      if (!refsMatch(parsed, parsedArt)) continue;

      const hasVerseOverlap = Boolean(parsed.verseStart && parsedArt.verseStart);
      const overlapBonus = hasVerseOverlap ? 0.15 : 0;
      const anchorRecency = anchor.score ?? recencyFromTime(anchor.t);
      const anchorBase =
        1.0 +
        anchorRecency +
        (anchor.dur_s != null ? (Math.min(anchor.dur_s, 15 * 60) / (15 * 60)) * 0.25 : 0);
      const score = anchorBase + scoreSupport(art) + overlapBonus;

      if (!best || score > best.score || (score === best.score && anchor.id < best.anchorId)) {
        best = { anchorId: anchor.id, score };
      }
    }

    if (!best) continue;
    const existing = artAssignments.get(art.id);
    if (
      !existing ||
      best.score > existing.score ||
      (best.score === existing.score && best.anchorId < existing.anchorId)
    ) {
      artAssignments.set(art.id, best);
    }
  }

  const byAnchor = new Map<string, Array<{ art: (typeof args.arts)[number]; s: number }>>();
  for (const art of args.arts) {
    const assigned = artAssignments.get(art.id);
    if (!assigned) continue;
    const list = byAnchor.get(assigned.anchorId) ?? [];
    list.push({ art, s: assigned.score });
    byAnchor.set(assigned.anchorId, list);
  }

  // Per-anchor: pick up to 2, preferring higher score, then recency, then id.
  const perAnchorPicked: Array<{ art: (typeof args.arts)[number]; s: number }> = [];
  for (const anchor of args.anchors) {
    const list = byAnchor.get(anchor.id) ?? [];
    const picked = list
      .slice()
      .sort((x, y) => {
        if (y.s !== x.s) return y.s - x.s;
        const yt = Date.parse(y.art.t ?? "");
        const xt = Date.parse(x.art.t ?? "");
        if (Number.isFinite(yt) && Number.isFinite(xt) && yt !== xt) return yt - xt;
        return x.art.id.localeCompare(y.art.id);
      })
      .slice(0, 2);
    perAnchorPicked.push(...picked);
  }

  const supportCapByTotal = Math.max(0, TOTAL_CAP - args.anchors.length);
  const finalSupportCap = Math.min(SUPPORT_CAP, supportCapByTotal);

  const finalArts = perAnchorPicked
    .slice()
    .sort((x, y) => {
      if (y.s !== x.s) return y.s - x.s;
      const yt = Date.parse(y.art.t ?? "");
      const xt = Date.parse(x.art.t ?? "");
      if (Number.isFinite(yt) && Number.isFinite(xt) && yt !== xt) return yt - xt;
      return x.art.id.localeCompare(y.art.id);
    })
    .slice(0, finalSupportCap)
    .map((x) => x.art);

  return { anchors: args.anchors, arts: finalArts };
};

export const compressContextBundle = (args: { raw: RawContextCandidatesBundle; enabledActions?: string[] }): ContextPack => {
  const candidatesRaw = args.raw.candidates;
  const candidates: RawCandidate[] = Array.isArray(candidatesRaw)
    ? candidatesRaw
        .filter((c): c is UnknownRecord => isRecord(c))
        .map((c) => ({
          id: asString((c as any).id) ?? "",
          source: asString((c as any).source) ?? "",
          preview: asString((c as any).preview) ?? undefined,
          metadata: isRecord((c as any).metadata) ? ((c as any).metadata as UnknownRecord) : undefined,
          features: isRecord((c as any).features) ? ((c as any).features as UnknownRecord) : undefined,
        }))
        .filter((c) => c.id && c.source)
    : [];

  const plan = getPlanCompact(args.raw.plan);
  const life = compressLife(candidates);
  const mem = compressMem(candidates);
  const anchorsRaw = compressReadingSessionsToAnchors(candidates);
  const anchorsPrimary = selectPrimaryAnchors(anchorsRaw);
  const { arts: artsRaw, convos } = compressArtifacts(candidates);
  const { anchors, arts } = attachSupportingArts({ anchors: anchorsPrimary, arts: artsRaw });
  const aff = Array.isArray(args.enabledActions)
    ? args.enabledActions
        .filter((a): a is string => typeof a === "string" && Boolean(a.trim()))
        .slice(0, 32)
    : undefined;

  return {
    ...(plan ? { plan } : {}),
    ...(life.length ? { life } : {}),
    ...(mem.length ? { mem } : {}),
    ...(anchors.length ? { anchors } : {}),
    ...(arts.length ? { arts } : {}),
    ...(convos.length ? { convos } : {}),
    ...(aff?.length ? { aff } : {}),
  };
};

export const getAllowedEvidenceIdsFromContext = (pack: unknown): string[] => {
  if (!isRecord(pack)) return [];
  const ids = new Set<string>();
  const collect = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (!isRecord(item)) continue;
      const id = asString((item as any).id);
      if (id) ids.add(id);
    }
  };
  collect((pack as any).life);
  collect((pack as any).mem);
  collect((pack as any).anchors);
  collect((pack as any).arts);
  collect((pack as any).convos);
  // Back-compat: accept older `{ candidates: [{id}] }` shape.
  collect((pack as any).candidates);
  return [...ids];
};

export const getAllowedActionTypesFromContext = (pack: unknown): string[] | null => {
  if (!isRecord(pack)) return null;
  const aff = (pack as any).aff;
  if (!Array.isArray(aff)) return null;
  const allowed = aff
    .filter((v): v is string => typeof v === "string" && Boolean(v.trim()))
    .map((v) => v.trim());
  return allowed.length ? allowed : null;
};


