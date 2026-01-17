export type ChapterCompletionStatus = {
  status: "none" | "glanced" | "in_progress" | "mostly_read" | "completed";
  readVersesCount: number;
  totalVersesCount?: number;
  coverageRatio?: number;
  durationSeconds: number;
  readRanges: string[];
  signals: string[];
  computedAt: string;
};

type VerseRange = { start: number; end: number };

const parseVerseRange = (raw: string): VerseRange | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Accept:
  // - "8:1-8" or "8:1"
  // - "1-8" or "1"
  const afterColon = trimmed.includes(":") ? trimmed.split(":").slice(1).join(":") : trimmed;
  const m = afterColon.match(/^(\d{1,3})(?:-(\d{1,3}))?$/);
  if (!m) return null;

  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const start = Math.max(1, Math.min(a, b));
  const end = Math.max(1, Math.max(a, b));
  return { start, end };
};

const countUniqueReadVerses = (readRanges: string[], maxVerse: number | null): number => {
  const verses = new Set<number>();
  for (const r of readRanges) {
    const parsed = parseVerseRange(r);
    if (!parsed) continue;
    const end = maxVerse != null ? Math.min(parsed.end, maxVerse) : parsed.end;
    for (let v = parsed.start; v <= end; v += 1) verses.add(v);
  }
  return verses.size;
};

export function computeChapterCompletionStatus(args: {
  readRanges: string[];
  durationSeconds: number;
  totalVersesCount?: number | null;
}): ChapterCompletionStatus {
  const totalVersesCount =
    typeof args.totalVersesCount === "number" && Number.isFinite(args.totalVersesCount) && args.totalVersesCount > 0
      ? Math.floor(args.totalVersesCount)
      : undefined;

  const readRanges = Array.isArray(args.readRanges) ? args.readRanges.filter(Boolean) : [];
  const readVersesCount = countUniqueReadVerses(readRanges, totalVersesCount ?? null);
  const durationSeconds = Math.max(0, Math.floor(args.durationSeconds || 0));

  const coverageRatio =
    totalVersesCount && totalVersesCount > 0 ? Math.min(1, readVersesCount / totalVersesCount) : undefined;

  const status: ChapterCompletionStatus["status"] = (() => {
    if (readVersesCount <= 0) return durationSeconds >= 30 ? "glanced" : "none";

    if (coverageRatio != null) {
      if (coverageRatio >= 0.9) return "completed";
      if (coverageRatio >= 0.6) return "mostly_read";
      return "in_progress";
    }

    // Fallback when we can't determine total verses.
    if (readVersesCount >= 20 && durationSeconds >= 120) return "mostly_read";
    return "in_progress";
  })();

  const signals: string[] = [];
  signals.push(`duration:${durationSeconds}s`);
  signals.push(`ranges:${readRanges.length}`);
  signals.push(`readVerses:${readVersesCount}`);
  if (coverageRatio != null) signals.push(`coverage:${coverageRatio.toFixed(2)}`);

  return {
    status,
    readVersesCount,
    ...(totalVersesCount ? { totalVersesCount } : {}),
    ...(coverageRatio != null ? { coverageRatio } : {}),
    durationSeconds,
    readRanges,
    signals,
    computedAt: new Date().toISOString(),
  };
}


