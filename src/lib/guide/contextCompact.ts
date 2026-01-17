// Backwards/compat: compact huge payloads before sending to the model.
// (Renamed from richContextCompact.ts)

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  !!value && typeof value === "object" && !Array.isArray(value);

const truncateString = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…(truncated)`;
};

const estimateJsonChars = (value: unknown): number => {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
};

const compactMetadata = (metadata: unknown): unknown => {
  if (!isRecord(metadata)) return metadata;

  const cleaned: UnknownRecord = {};
  for (const [key, rawValue] of Object.entries(metadata)) {
    if (key === "fullContent" || key === "artifactMetadata") continue;

    if (typeof rawValue === "string") {
      cleaned[key] = truncateString(rawValue, 800);
      continue;
    }

    if (Array.isArray(rawValue)) {
      // keep small arrays of scalars; truncate string elements
      const limited = rawValue.slice(0, 50).map((v) => (typeof v === "string" ? truncateString(v, 200) : v));
      cleaned[key] = limited;
      continue;
    }

    cleaned[key] = rawValue;
  }

  // If metadata is still huge, keep only scalar-ish keys.
  if (estimateJsonChars(cleaned) <= 20_000) return cleaned;

  const reduced: UnknownRecord = {};
  for (const [key, rawValue] of Object.entries(cleaned)) {
    if (rawValue == null || typeof rawValue === "number" || typeof rawValue === "boolean") {
      reduced[key] = rawValue;
      continue;
    }
    if (typeof rawValue === "string") {
      reduced[key] = truncateString(rawValue, 200);
      continue;
    }
    if (
      Array.isArray(rawValue) &&
      rawValue.length <= 20 &&
      rawValue.every((v) => v == null || ["string", "number", "boolean"].includes(typeof v))
    ) {
      reduced[key] = rawValue.map((v) => (typeof v === "string" ? truncateString(v, 120) : v));
    }
  }
  return reduced;
};

const compactCandidate = (candidate: unknown): unknown => {
  if (!isRecord(candidate)) return candidate;

  const compacted: UnknownRecord = {};
  if (typeof candidate.id === "string") compacted.id = candidate.id;
  if (typeof candidate.source === "string") compacted.source = candidate.source;
  if (typeof candidate.label === "string") compacted.label = truncateString(candidate.label, 200);
  if (typeof candidate.preview === "string") compacted.preview = truncateString(candidate.preview, 900);
  if (candidate.features != null) compacted.features = candidate.features;
  if (candidate.metadata != null) compacted.metadata = compactMetadata(candidate.metadata);

  // Preserve any small scalar fields not covered above (e.g. score)
  for (const [key, value] of Object.entries(candidate)) {
    if (key in compacted) continue;
    if (value == null || typeof value === "number" || typeof value === "boolean") compacted[key] = value;
    if (typeof value === "string") compacted[key] = truncateString(value, 200);
  }

  return compacted;
};

export const compactContextCandidatesPayload = (payload: unknown): unknown => {
  if (!isRecord(payload)) return payload;

  const candidatesRaw = (payload as any).candidates;
  const candidates = Array.isArray(candidatesRaw) ? candidatesRaw.map(compactCandidate) : candidatesRaw;

  return {
    ...payload,
    ...(candidates !== undefined ? { candidates } : {}),
  };
};


