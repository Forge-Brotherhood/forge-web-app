import type { EvalSuite } from "@/lib/evals/types";

/**
 * A rough cost for a run, shown before it starts. Prompt length is known exactly; tokens are taken
 * as four characters each, and what the model writes (reasoning included) is a guess. Both the
 * case model and the grader are gpt-5.5, at OpenAI's list price.
 */

const USD_PER_INPUT_TOKEN = 5 / 1_000_000;
const USD_PER_OUTPUT_TOKEN = 30 / 1_000_000;
const CHARS_PER_TOKEN = 4;
/** Output tokens assumed for one case call and one grader call, reasoning included. */
const CASE_OUTPUT_TOKENS = 2000;
const GRADER_OUTPUT_TOKENS = 600;
/** Room for the case's output and the grader's own instructions in the grader's input. */
const GRADER_EXTRA_CHARS = 3000;

const callUsd = (inputChars: number, outputTokens: number) =>
  (inputChars / CHARS_PER_TOKEN) * USD_PER_INPUT_TOKEN + outputTokens * USD_PER_OUTPUT_TOKEN;

/** One run of one case: its own model call, then the grader. Nothing when it makes no model call. */
export const caseUsd = (suite: EvalSuite, caseId: string): number => {
  const chars = suite.promptChars(caseId);
  if (!chars) return 0;
  const graderChars = suite.rubric.length + suite.graderContext(caseId).length + GRADER_EXTRA_CHARS;
  return callUsd(chars, CASE_OUTPUT_TOKENS) + callUsd(graderChars, GRADER_OUTPUT_TOKENS);
};

export const estimateUsd = (suite: EvalSuite, caseIds: string[], repeats: number): number =>
  caseIds.reduce((sum, id) => sum + caseUsd(suite, id), 0) * repeats;
