/**
 * AI Observability Logger
 *
 * Logs events and debug envelopes to a configurable backend.
 * Uses Axiom when configured, falls back to console in development.
 */

import type { AIDebugEnvelope } from "./debugEnvelope";
import type { AIEvent } from "./events";

// =============================================================================
// Configuration
// =============================================================================

interface LoggerConfig {
  /** Whether AI tracing is enabled */
  enabled: boolean;
  /** Axiom API token */
  axiomToken?: string;
  /** Axiom organization ID */
  axiomOrgId?: string;
  /** Axiom dataset for events */
  axiomEventsDataset: string;
  /** Axiom dataset for envelopes */
  axiomEnvelopesDataset: string;
  /** Whether to log to console (always true in development) */
  consoleLog: boolean;
}

function getConfig(): LoggerConfig {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    enabled: process.env.ENABLE_AI_TRACING === "true" || !isProduction,
    axiomToken: process.env.AXIOM_TOKEN,
    axiomOrgId: process.env.AXIOM_ORG_ID,
    axiomEventsDataset: process.env.AXIOM_EVENTS_DATASET || "ai-events",
    axiomEnvelopesDataset: process.env.AXIOM_ENVELOPES_DATASET || "ai-envelopes",
    consoleLog: !isProduction || process.env.AI_CONSOLE_LOG === "true",
  };
}

// =============================================================================
// Axiom Client
// =============================================================================

async function sendToAxiom(
  dataset: string,
  data: unknown[]
): Promise<boolean> {
  const config = getConfig();

  if (!config.axiomToken) {
    return false;
  }

  try {
    const response = await fetch(
      `https://api.axiom.co/v1/datasets/${dataset}/ingest`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.axiomToken}`,
          ...(config.axiomOrgId && { "X-Axiom-Org-Id": config.axiomOrgId }),
        },
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(
        `[AILogger] Axiom ingest failed: ${response.status} ${response.statusText}`,
        errorBody ? `- ${errorBody}` : ""
      );
      // Log hint for common issues
      if (response.status === 403) {
        console.error(
          "[AILogger] Hint: Ensure AXIOM_TOKEN is an API token with ingest permissions, not a personal token"
        );
      } else if (response.status === 404) {
        console.error(
          `[AILogger] Hint: Dataset '${dataset}' may not exist. Create it in Axiom dashboard.`
        );
      }
      return false;
    }

    return true;
  } catch (error) {
    console.error("[AILogger] Axiom ingest error:", error);
    return false;
  }
}

// =============================================================================
// Logger Implementation
// =============================================================================

/**
 * Log an AI event
 */
export async function logEvent(event: AIEvent): Promise<void> {
  const config = getConfig();

  if (!config.enabled) return;

  // Console logging
  if (config.consoleLog) {
    console.log(
      `[AI:${event.type}]`,
      JSON.stringify(
        {
          trace_id: event.traceId,
          ...event,
        },
        null,
        2
      )
    );
  }

  // Axiom logging (fire and forget)
  if (config.axiomToken) {
    sendToAxiom(config.axiomEventsDataset, [
      {
        _time: event.timestamp,
        ...event,
      },
    ]).catch(() => {
      // Silently ignore Axiom errors to not affect request
    });
  }
}

/**
 * Log a complete debug envelope
 */
export async function logEnvelope(envelope: AIDebugEnvelope): Promise<void> {
  const config = getConfig();

  if (!config.enabled) return;

  // Console logging (summarized version)
  if (config.consoleLog) {
    console.log(
      `[AI:envelope]`,
      JSON.stringify(
        {
          trace_id: envelope.traceId,
          entry_point: envelope.entryPoint,
          response_type: envelope.response.responseType,
          latency_ms: envelope.modelCall.latencyMs,
          tokens: {
            input: envelope.modelCall.inputTokens,
            output: envelope.modelCall.outputTokens,
          },
          memories: {
            queried: envelope.contextReport.memoriesQueried,
            included: envelope.contextReport.memoriesIncluded,
          },
          actions: envelope.postProcessing.actionsExtracted.length,
        },
        null,
        2
      )
    );
  }

  // Axiom logging (fire and forget)
  if (config.axiomToken) {
    sendToAxiom(config.axiomEnvelopesDataset, [
      {
        _time: envelope.timestamp,
        ...envelope,
      },
    ]).catch(() => {
      // Silently ignore Axiom errors to not affect request
    });
  }
}

/**
 * Log an error with trace context
 */
export async function logError(
  traceId: string,
  requestId: string,
  error: Error,
  context: Record<string, unknown> = {}
): Promise<void> {
  const config = getConfig();

  if (!config.enabled) return;

  const errorData = {
    type: "ai.error",
    trace_id: traceId,
    request_id: requestId,
    timestamp: new Date().toISOString(),
    error_name: error.name,
    error_message: error.message,
    error_stack: error.stack,
    ...context,
  };

  // Console logging
  if (config.consoleLog) {
    console.error(`[AI:error]`, JSON.stringify(errorData, null, 2));
  }

  // Axiom logging
  if (config.axiomToken) {
    sendToAxiom(config.axiomEventsDataset, [
      {
        _time: errorData.timestamp,
        ...errorData,
      },
    ]).catch(() => {
      // Silently ignore
    });
  }
}

// =============================================================================
// Batch Logger (for high-volume scenarios)
// =============================================================================

class EventBatcher {
  private events: AIEvent[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  private readonly maxBatchSize = 100;
  private readonly flushIntervalMs = 5000;

  add(event: AIEvent): void {
    this.events.push(event);

    if (this.events.length >= this.maxBatchSize) {
      this.flush();
    } else if (!this.flushTimeout) {
      this.flushTimeout = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    if (this.events.length === 0) return;

    const batch = this.events.splice(0, this.events.length);
    const config = getConfig();

    if (config.axiomToken) {
      await sendToAxiom(
        config.axiomEventsDataset,
        batch.map((e) => ({ _time: e.timestamp, ...e }))
      );
    }
  }
}

export const eventBatcher = new EventBatcher();

// =============================================================================
// Convenience Exports
// =============================================================================

export const aiLogger = {
  event: logEvent,
  envelope: logEnvelope,
  error: logError,
  batchEvent: (event: AIEvent) => eventBatcher.add(event),
  flushBatch: () => eventBatcher.flush(),
};

export default aiLogger;
