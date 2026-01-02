/**
 * INGRESS Stage Payload
 *
 * Output from the input normalization and unified planning stage.
 */

import type { EntityRef } from "../types";
import type { Plan } from "../plan/types";

export const INGRESS_SCHEMA_VERSION = "2.0.0";

export interface IngressPayload {
  schemaVersion: typeof INGRESS_SCHEMA_VERSION;
  normalizedInput: string;
  detectedEntities: EntityRef[];
  plan: Plan;
}
