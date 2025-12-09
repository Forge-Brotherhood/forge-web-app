#!/usr/bin/env npx tsx
/**
 * Bible Chapter Content Cache Warming Script
 *
 * Pre-populates the cache with Bible chapter content from API.Bible.
 *
 * Usage:
 *   npx tsx scripts/warm-chapter-cache.ts --book GEN
 *   npx tsx scripts/warm-chapter-cache.ts --all
 *   npx tsx scripts/warm-chapter-cache.ts --book MAT --skip-cached
 */

import { config } from "dotenv";
import * as path from "path";
import * as readline from "readline";

// Load .env from project root BEFORE importing modules that read env vars
config({ path: path.resolve(__dirname, "..", ".env") });

// Book code to name mapping
const BOOK_CODE_TO_NAME: Record<string, string> = {
  GEN: "Genesis",
  EXO: "Exodus",
  LEV: "Leviticus",
  NUM: "Numbers",
  DEU: "Deuteronomy",
  JOS: "Joshua",
  JDG: "Judges",
  RUT: "Ruth",
  "1SA": "1 Samuel",
  "2SA": "2 Samuel",
  "1KI": "1 Kings",
  "2KI": "2 Kings",
  "1CH": "1 Chronicles",
  "2CH": "2 Chronicles",
  EZR: "Ezra",
  NEH: "Nehemiah",
  EST: "Esther",
  JOB: "Job",
  PSA: "Psalms",
  PRO: "Proverbs",
  ECC: "Ecclesiastes",
  SNG: "Song of Solomon",
  ISA: "Isaiah",
  JER: "Jeremiah",
  LAM: "Lamentations",
  EZK: "Ezekiel",
  DAN: "Daniel",
  HOS: "Hosea",
  JOL: "Joel",
  AMO: "Amos",
  OBA: "Obadiah",
  JON: "Jonah",
  MIC: "Micah",
  NAM: "Nahum",
  HAB: "Habakkuk",
  ZEP: "Zephaniah",
  HAG: "Haggai",
  ZEC: "Zechariah",
  MAL: "Malachi",
  MAT: "Matthew",
  MRK: "Mark",
  LUK: "Luke",
  JHN: "John",
  ACT: "Acts",
  ROM: "Romans",
  "1CO": "1 Corinthians",
  "2CO": "2 Corinthians",
  GAL: "Galatians",
  EPH: "Ephesians",
  PHP: "Philippians",
  COL: "Colossians",
  "1TH": "1 Thessalonians",
  "2TH": "2 Thessalonians",
  "1TI": "1 Timothy",
  "2TI": "2 Timothy",
  TIT: "Titus",
  PHM: "Philemon",
  HEB: "Hebrews",
  JAS: "James",
  "1PE": "1 Peter",
  "2PE": "2 Peter",
  "1JN": "1 John",
  "2JN": "2 John",
  "3JN": "3 John",
  JUD: "Jude",
  REV: "Revelation",
};

const ALL_BOOK_CODES = Object.keys(BOOK_CODE_TO_NAME);

// Rate limiting - API.Bible has rate limits
const DELAY_BETWEEN_CHAPTERS_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

async function main() {
  // Dynamic imports after env is loaded
  const { bibleService } = await import("../src/lib/bible");
  const { getKVClient, CacheKeys } = await import("../src/lib/kv");

  const args = process.argv.slice(2);

  let bookCodes: string[] = [];
  let skipCached = false;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--book" && args[i + 1]) {
      bookCodes.push(args[i + 1].toUpperCase());
      i++;
    } else if (args[i] === "--all") {
      bookCodes = ALL_BOOK_CODES;
    } else if (args[i] === "--skip-cached") {
      skipCached = true;
    }
  }

  if (bookCodes.length === 0) {
    console.log(`
Bible Chapter Content Cache Warming Script

Usage:
  npx tsx scripts/warm-chapter-cache.ts --book GEN
  npx tsx scripts/warm-chapter-cache.ts --book MAT --skip-cached
  npx tsx scripts/warm-chapter-cache.ts --all

Options:
  --book <CODE>   Warm a specific book (e.g., GEN, MAT, ROM)
  --all           Warm all 66 books
  --skip-cached   Skip chapters that are already cached

Book codes:
  OT: GEN, EXO, LEV, NUM, DEU, JOS, JDG, RUT, 1SA, 2SA, 1KI, 2KI,
      1CH, 2CH, EZR, NEH, EST, JOB, PSA, PRO, ECC, SNG, ISA, JER,
      LAM, EZK, DAN, HOS, JOL, AMO, OBA, JON, MIC, NAM, HAB, ZEP,
      HAG, ZEC, MAL
  NT: MAT, MRK, LUK, JHN, ACT, ROM, 1CO, 2CO, GAL, EPH, PHP, COL,
      1TH, 2TH, 1TI, 2TI, TIT, PHM, HEB, JAS, 1PE, 2PE, 1JN, 2JN,
      3JN, JUD, REV
`);
    process.exit(0);
  }

  console.log("📖 Bible Chapter Content Cache Warming Script");
  console.log("=============================================\n");

  // Helper to check if chapter is cached
  async function isChapterCached(chapterId: string, translation: string): Promise<boolean> {
    const kv = getKVClient();
    const key = CacheKeys.chapterContent(translation, chapterId);
    const cached = await kv.get(key);
    return cached !== null;
  }

  // Helper to warm a single book
  async function warmBook(
    bookCode: string,
    translation: string = "BSB"
  ): Promise<{ total: number; success: number; skipped: number; failed: number }> {
    const bookName = BOOK_CODE_TO_NAME[bookCode];
    if (!bookName) {
      console.error(`Unknown book code: ${bookCode}`);
      return { total: 0, success: 0, skipped: 0, failed: 0 };
    }

    console.log(`\n📖 Warming cache for ${bookName} (${bookCode})...\n`);

    const chapters = await bibleService.getChapters(bookCode);
    console.log(`Found ${chapters.length} chapters\n`);

    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (const chapter of chapters) {
      const chapterRef = `${bookName} ${chapter.number}`;

      if (skipCached) {
        const cached = await isChapterCached(chapter.id, translation);
        if (cached) {
          console.log(`  [SKIP] ${chapterRef} already cached`);
          skipped++;
          continue;
        }
      }

      try {
        await bibleService.getChapterContent(chapter.id);
        console.log(`  [OK] ${chapterRef} cached`);
        success++;
      } catch (error) {
        console.log(`  [ERROR] ${chapterRef}: ${error}`);
        failed++;
      }

      await sleep(DELAY_BETWEEN_CHAPTERS_MS);
    }

    return { total: chapters.length, success, skipped, failed };
  }

  // Calculate total chapters
  console.log("Calculating chapters...\n");

  let totalChapters = 0;
  const bookChapterCounts: { code: string; name: string; chapters: number }[] = [];

  for (const bookCode of bookCodes) {
    const bookName = BOOK_CODE_TO_NAME[bookCode];
    if (!bookName) {
      console.error(`Unknown book code: ${bookCode}`);
      continue;
    }

    try {
      const chapters = await bibleService.getChapters(bookCode);
      bookChapterCounts.push({ code: bookCode, name: bookName, chapters: chapters.length });
      totalChapters += chapters.length;
    } catch (error) {
      console.error(`Failed to get chapters for ${bookCode}: ${error}`);
    }
  }

  const bibleApiCallsRemaining = totalChapters;

  console.log("=============================================");
  console.log("📊 Pre-run Summary");
  console.log("=============================================");
  console.log(`Books to warm: ${bookChapterCounts.length}`);
  console.log(`Skip cached: ${skipCached}`);
  console.log(`Total chapters: ${totalChapters}`);
  console.log("");
  console.log(`API.Bible calls (max): ${bibleApiCallsRemaining}`);
  console.log("=============================================\n");

  if (bookChapterCounts.length <= 10) {
    console.log("Books:");
    for (const book of bookChapterCounts) {
      console.log(`  ${book.name} (${book.code}): ${book.chapters} chapters`);
    }
    console.log("");
  }

  const confirmed = await askConfirmation("Proceed with cache warming? (Y/n): ");

  if (!confirmed) {
    console.log("\nAborted by user.");
    process.exit(0);
  }

  console.log("\nStarting cache warming...\n");

  const startTime = Date.now();
  let totalSuccess = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const bookCode of bookCodes) {
    const result = await warmBook(bookCode);
    totalSuccess += result.success;
    totalSkipped += result.skipped;
    totalFailed += result.failed;
  }

  const duration = Math.round((Date.now() - startTime) / 1000);

  console.log("\n=============================================");
  console.log("📊 Summary");
  console.log("=============================================");
  console.log(`Total chapters: ${totalChapters}`);
  console.log(`Success: ${totalSuccess}`);
  console.log(`Skipped (cached): ${totalSkipped}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Duration: ${Math.floor(duration / 60)}m ${duration % 60}s`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
