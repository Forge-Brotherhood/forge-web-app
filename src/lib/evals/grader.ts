import type { EvalCase, Grade } from "@/lib/evals/types";

/**
 * The grader: a second model call that holds one output to the suite's rubric and answers pass or
 * fail with a reason. It is a helper for the person reading the results, not the judge.
 */

export const GRADER_MODEL = "gpt-5.5";

const GRADER_INSTRUCTIONS = `You grade one output of an AI model against a rubric. Read the rubric, what the input was, what a good output does, and the output itself. Then answer with JSON only: {"pass": true or false, "reason": "one or two sentences"}. On a fail, quote the words that fail and name the rule they break. Pass only if the output holds to every rule.`;

export const graderInput = (args: { rubric: string; evalCase: EvalCase; context: string; output: string }): string =>
  [
    `RUBRIC:\n${args.rubric}`,
    `THE INPUT: ${args.evalCase.input}`,
    args.context ? `DETAILS OF THE INPUT:\n${args.context}` : "",
    `A GOOD OUTPUT: ${args.evalCase.expect}`,
    `THE OUTPUT:\n${args.output}`,
    // JSON mode needs the word in the input itself, not only in the instructions.
    "Return the JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");

/** The grader's answer, or null when it is not the shape asked for. */
export const parseGrade = (raw: unknown): Grade | null => {
  const r = raw as { pass?: unknown; reason?: unknown } | null;
  if (!r || typeof r.pass !== "boolean" || typeof r.reason !== "string" || !r.reason.trim()) return null;
  return { pass: r.pass, reason: r.reason.trim() };
};

export type Grader = (input: string) => Promise<Grade>;

export const callGrader: Grader = async (input) => {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) throw new Error("OPENAI_API_KEY not configured");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiApiKey}` },
    body: JSON.stringify({
      model: GRADER_MODEL,
      store: false,
      reasoning: { effort: "low" },
      instructions: GRADER_INSTRUCTIONS,
      input,
      max_output_tokens: 2000,
      text: { format: { type: "json_object" } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

  const output = ((await response.json()) as any)?.output ?? [];
  const content = output.flatMap((item: any) => item?.content ?? []).find((c: any) => c?.type === "output_text")?.text;
  const grade = typeof content === "string" ? parseGrade(JSON.parse(content)) : null;
  if (!grade) throw new Error("The grader did not answer pass or fail with a reason");
  return grade;
};
