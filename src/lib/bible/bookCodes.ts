// Side-effect free Bible book code/name utilities.

// Book name to API.Bible code mapping
export const BOOK_NAME_TO_CODE: Record<string, string> = {
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
  psalm: "PSA",
  proverbs: "PRO",
  ecclesiastes: "ECC",
  "song of solomon": "SNG",
  "song of songs": "SNG",
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

const LOWERCASE_WORDS = new Set(["of", "and", "the"]);

const toDisplayTitleCase = (input: string): string =>
  input
    .split(/\s+/g)
    .filter(Boolean)
    .map((word, idx) => {
      if (/^\d+$/.test(word)) return word;
      const lower = word.toLowerCase();
      if (idx > 0 && LOWERCASE_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");

/**
 * Best-effort mapping from API.Bible book codes (e.g. "JHN") to a display name
 * (e.g. "John"). Picks the longest known name variant for each code.
 */
const BOOK_CODE_TO_CANONICAL_NAME: Record<string, string> = Object.entries(BOOK_NAME_TO_CODE).reduce<
  Record<string, string>
>((acc, [name, code]) => {
  const upperCode = code.toUpperCase();
  const existing = acc[upperCode];
  if (!existing || name.length > existing.length) acc[upperCode] = name;
  return acc;
}, {});

export const getBookDisplayNameFromCode = (bookCode: unknown): string | null => {
  if (typeof bookCode !== "string") return null;
  const normalized = bookCode.trim();
  if (!normalized) return null;

  const key = BOOK_CODE_TO_CANONICAL_NAME[normalized.toUpperCase()];
  if (!key) return null;
  return toDisplayTitleCase(key);
};


