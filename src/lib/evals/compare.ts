/**
 * Two runs of one suite side by side, case by case: how many of each case's repeats passed in the
 * earlier run and in the later one. Cases that got worse come first, then those that got better.
 */

export type CaseTally = { passed: number; total: number };
export type CaseComparison = {
  caseId: string;
  before: CaseTally | null;
  after: CaseTally | null;
  change: "worse" | "better" | "same" | "only_before" | "only_after";
};

const tally = (results: Array<{ caseId: string; passed: boolean }>) => {
  const out = new Map<string, CaseTally>();
  for (const r of results) {
    const t = out.get(r.caseId) ?? { passed: 0, total: 0 };
    t.total += 1;
    if (r.passed) t.passed += 1;
    out.set(r.caseId, t);
  }
  return out;
};

const ORDER: CaseComparison["change"][] = ["worse", "better", "only_before", "only_after", "same"];

export const compareRuns = (
  before: Array<{ caseId: string; passed: boolean }>,
  after: Array<{ caseId: string; passed: boolean }>
): CaseComparison[] => {
  const a = tally(before);
  const b = tally(after);
  const ids = [...new Set([...a.keys(), ...b.keys()])];
  return ids
    .map((caseId): CaseComparison => {
      const x = a.get(caseId) ?? null;
      const y = b.get(caseId) ?? null;
      const change = !x
        ? "only_after"
        : !y
          ? "only_before"
          : y.passed / y.total < x.passed / x.total
            ? "worse"
            : y.passed / y.total > x.passed / x.total
              ? "better"
              : "same";
      return { caseId, before: x, after: y, change };
    })
    .sort((p, q) => ORDER.indexOf(p.change) - ORDER.indexOf(q.change) || p.caseId.localeCompare(q.caseId));
};
