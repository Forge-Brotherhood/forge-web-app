import { graderInput, type Grader } from "@/lib/evals/grader";
import type { EvalItemResult, EvalSuite } from "@/lib/evals/types";

/**
 * Runs one case once: the code checks first, then the grader. It passes only when every check
 * passes and the grader (when there is something to grade) does too. A failure along the way is
 * kept as the item's error, so one bad call does not stop the run.
 */
export async function runItem(suite: EvalSuite, caseId: string, repeat: number, grade: Grader): Promise<EvalItemResult> {
  const started = Date.now();
  const evalCase = suite.cases.find((c) => c.id === caseId);
  if (!evalCase) throw new Error(`No case ${caseId} in ${suite.id}`);

  const result: EvalItemResult = { caseId, repeat, output: "", checks: [], grade: null, passed: false, durationMs: 0 };
  try {
    const run = await suite.run(caseId);
    Object.assign(result, { output: run.output, raw: run.raw, checks: run.checks });
    if (run.gradable) {
      result.grade = await grade(graderInput({ rubric: suite.rubric, evalCase, context: suite.graderContext(caseId), output: run.output }));
    }
    result.passed = run.checks.every((c) => c.pass) && (result.grade?.pass ?? true);
  } catch (error) {
    result.error = error instanceof Error ? error.message : "Failed";
  }
  result.durationMs = Date.now() - started;
  return result;
}
