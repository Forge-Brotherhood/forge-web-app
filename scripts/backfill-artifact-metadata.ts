/**
 * Backfill canonical scripture metadata fields on artifacts.
 *
 * Default: dry-run (no writes)
 * To apply:  tsx scripts/backfill-artifact-metadata.ts --apply
 *
 * Optional:
 *  --limit=500
 */

import { prisma } from "@/lib/prisma";
import { parseReference } from "@/lib/bibleReference";
import { Prisma } from "@prisma/client";

const args = process.argv.slice(2);
const isApply = args.includes("--apply");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Math.max(1, parseInt(limitArg.split("=")[1] || "0", 10)) : 1000;

const BOOK_NAME_TO_CODE: Record<string, string> = {
  genesis: "GEN",
  exodus: "EXO",
  leviticus: "LEV",
  numbers: "NUM",
  deuteronomy: "DEU",
  joshua: "JOS",
  judges: "JDG",
  ruth: "RUT",
  "1 samuel": "1SA",
  "2 samuel": "2SA",
  "1 kings": "1KI",
  "2 kings": "2KI",
  "1 chronicles": "1CH",
  "2 chronicles": "2CH",
  ezra: "EZR",
  nehemiah: "NEH",
  esther: "EST",
  job: "JOB",
  psalms: "PSA",
  proverbs: "PRO",
  ecclesiastes: "ECC",
  "song of solomon": "SNG",
  isaiah: "ISA",
  jeremiah: "JER",
  lamentations: "LAM",
  ezekiel: "EZK",
  daniel: "DAN",
  hosea: "HOS",
  joel: "JOL",
  amos: "AMO",
  obadiah: "OBA",
  jonah: "JON",
  micah: "MIC",
  nahum: "NAM",
  habakkuk: "HAB",
  zephaniah: "ZEP",
  haggai: "HAG",
  zechariah: "ZEC",
  malachi: "MAL",
  matthew: "MAT",
  mark: "MRK",
  luke: "LUK",
  john: "JHN",
  acts: "ACT",
  romans: "ROM",
  "1 corinthians": "1CO",
  "2 corinthians": "2CO",
  galatians: "GAL",
  ephesians: "EPH",
  philippians: "PHP",
  colossians: "COL",
  "1 thessalonians": "1TH",
  "2 thessalonians": "2TH",
  "1 timothy": "1TI",
  "2 timothy": "2TI",
  titus: "TIT",
  philemon: "PHM",
  hebrews: "HEB",
  james: "JAS",
  "1 peter": "1PE",
  "2 peter": "2PE",
  "1 john": "1JN",
  "2 john": "2JN",
  "3 john": "3JN",
  jude: "JUD",
  revelation: "REV",
};

type JsonObj = Record<string, unknown>;

function isObject(value: unknown): value is JsonObj {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function deriveBookIdFromVerseId(verseId: string | undefined): string | undefined {
  if (!verseId) return undefined;
  // underscore format: ACT_6_2
  const underscore = verseId.match(/^([A-Z0-9]{3})_/);
  if (underscore) return underscore[1];
  return undefined;
}

function deriveBookIdFromScriptureRef(ref: unknown): { bookId?: string; bookName?: string } {
  if (!Array.isArray(ref) || ref.length === 0) return {};
  const first = getString(ref[0]);
  if (!first) return {};

  const parsed = parseReference(first);
  if (!parsed) return {};

  const bookId = BOOK_NAME_TO_CODE[parsed.book.toLowerCase()];
  return { bookId, bookName: parsed.book };
}

async function main(): Promise<void> {
  console.log(`[backfill-artifact-metadata] mode=${isApply ? "apply" : "dry-run"} limit=${limit}`);

  const artifacts = await prisma.artifact.findMany({
    where: {
      type: { in: ["verse_highlight", "verse_note"] },
      status: "active",
    },
    select: {
      id: true,
      type: true,
      metadata: true,
      scriptureRefs: true,
    },
    take: limit,
  });

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let unable = 0;

  for (const artifact of artifacts) {
    scanned++;
    const metadata = isObject(artifact.metadata) ? (artifact.metadata as JsonObj) : {};

    const existingBookId = getString(metadata.bookId);
    const existingBookName = getString(metadata.bookName);

    if (existingBookId && existingBookName) {
      skipped++;
      continue;
    }

    const verseId = getString(metadata.verseId);
    const legacyBook = getString(metadata.book);

    const derivedFromVerseId = deriveBookIdFromVerseId(verseId);
    const derivedFromScripture = deriveBookIdFromScriptureRef(artifact.scriptureRefs);

    const bookId =
      existingBookId ||
      derivedFromVerseId ||
      // verse_note legacy: metadata.book was already bookId
      (artifact.type === "verse_note" ? legacyBook : undefined) ||
      derivedFromScripture.bookId;

    const bookName =
      existingBookName ||
      // verse_highlight legacy: metadata.book was display name
      (artifact.type === "verse_highlight" ? legacyBook : undefined) ||
      derivedFromScripture.bookName;

    if (!bookId) {
      unable++;
      continue;
    }

    const nextMetadata: JsonObj = {
      ...metadata,
      bookId,
      ...(bookName ? { bookName } : {}),
      // Preserve legacy `book` field as-is (do not overwrite)
    };

    if (!isApply) {
      updated++;
      continue;
    }

    await prisma.artifact.update({
      where: { id: artifact.id },
      data: { metadata: nextMetadata as unknown as Prisma.InputJsonValue },
    });
    updated++;
  }

  console.log(
    `[backfill-artifact-metadata] scanned=${scanned} updated=${updated} skipped=${skipped} unable=${unable}`
  );
  if (!isApply) {
    console.log("[backfill-artifact-metadata] dry-run complete. Re-run with --apply to persist changes.");
  }
}

main().catch((err) => {
  console.error("[backfill-artifact-metadata] failed:", err);
  process.exitCode = 1;
});


