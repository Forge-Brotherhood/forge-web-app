import { GRADER_MODEL } from "@/lib/evals/grader";
import type { EvalSuite } from "@/lib/evals/types";

/**
 * A rough cost for a run, shown before it starts. Prompt length is known exactly; tokens are taken
 * as four characters each, and what the model writes (reasoning included) is a guess. Prices are
 * OpenAI's list prices, in dollars per million input and output tokens.
 */

const USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-5.5": { input: 5, output: 30 },
  "gpt-6.2-sol": { input: 2, output: 10 },
};
const CHARS_PER_TOKEN = 4;
/** Output tokens assumed for one case call and one grader call, reasoning included. */
const CASE_OUTPUT_TOKENS = 2000;
const GRADER_OUTPUT_TOKENS = 600;
/** Room for the case's output and the grader's own instructions in the grader's input. */
const GRADER_EXTRA_CHARS = 3000;

const callUsd = (model: string, inputChars: number, outputTokens: number) => {
  const price = USD_PER_MILLION[model] ?? USD_PER_MILLION[GRADER_MODEL];
  return ((inputChars / CHARS_PER_TOKEN) * price.input + outputTokens * price.output) / 1_000_000;
};

/** One run of one case: its own model call, then the grader. Nothing when it makes no model call. */
export const caseUsd = (suite: EvalSuite, caseId: string): number => {
  const chars = suite.promptChars(caseId);
  if (!chars) return 0;
  const graderChars = suite.rubric.length + suite.graderContext(caseId).length + GRADER_EXTRA_CHARS;
  return callUsd(suite.model, chars, CASE_OUTPUT_TOKENS) + callUsd(GRADER_MODEL, graderChars, GRADER_OUTPUT_TOKENS);
};

export const estimateUsd = (suite: EvalSuite, caseIds: string[], repeats: number): number =>
  caseIds.reduce((sum, id) => sum + caseUsd(suite, id), 0) * repeats;
