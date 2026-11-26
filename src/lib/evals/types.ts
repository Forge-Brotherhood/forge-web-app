/**
 * Model-quality evals: fixed sets of synthetic cases run through the real model, checked in code
 * and then graded by a second model call against a rubric. Inputs are synthetic fixtures only,
 * never a person's brief or content, so storing them and what the model said is fine.
 */

export type EvalCheck = { name: string; pass: boolean; detail?: string };

export type EvalCase = {
  id: string;
  title: string;
  /** What the input is, in a line or two, for a person reading the results. */
  input: string;
  /** What a good output does. The grader is given this too. */
  expect: string;
};

/** One run of one case. */
export type CaseRun = {
  /** What the model produced, as a person should read it. The grader sees the same text. */
  output: string;
  /** The model's own answer before any checks, when there was one. */
  raw?: unknown;
  checks: EvalCheck[];
  /** False when the model was not asked, so there is nothing of its own to grade. */
  gradable: boolean;
};

export type EvalSuite = {
  id: string;
  title: string;
  description: string;
  /** How many times each case runs by default: the wording varies from run to run. */
  repeats: number;
  /** The model the cases call, for the cost estimate. */
  model: string;
  /** Changes when the model or the prompt does, so runs before and after a change can be told apart. */
  version: string;
  /** What the grader holds the output to. */
  rubric: string;
  cases: EvalCase[];
  /** Characters sent to the model by one run of a case, or 0 when the case makes no model call. */
  promptChars: (caseId: string) => number;
  /** What the grader is told about the input, beyond the case's summary and expectation. */
  graderContext: (caseId: string) => string;
  run: (caseId: string) => Promise<CaseRun>;
};

export type Grade = { pass: boolean; reason: string };

/** What is stored for one run of one case. */
export type EvalItemResult = {
  caseId: string;
  repeat: number;
  output: string;
  raw?: unknown;
  checks: EvalCheck[];
  /** Null when the case was not graded (no model call, or it failed before grading). */
  grade: Grade | null;
  passed: boolean;
  error?: string;
  durationMs: number;
};
