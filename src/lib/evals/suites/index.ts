import { heartbeatSuite } from "@/lib/evals/suites/heartbeat";
import type { EvalSuite } from "@/lib/evals/types";

/** Every eval suite. A new one is a file next to heartbeat.ts, added here. */
export const EVAL_SUITES: EvalSuite[] = [heartbeatSuite];

export const evalSuite = (id: string): EvalSuite | undefined => EVAL_SUITES.find((s) => s.id === id);
