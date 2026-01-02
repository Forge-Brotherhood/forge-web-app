/**
 * Trace Context for AI Request Observability
 *
 * Extracts trace context from incoming requests and generates server-side IDs.
 */

import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

// =============================================================================
// Types
// =============================================================================

export interface TraceContext {
  /** Client-generated trace ID for this AI interaction */
  traceId: string;

  /** Client session ID (persists across app backgrounding) */
  sessionId: string;

  /** Authenticated user ID */
  userId: string;

  /** Where the AI interaction was initiated */
  entryPoint: string;

  /** Server-generated request ID for this specific request */
  requestId: string;

  /** App version from client */
  appVersion: string;

  /** Platform (ios, android, web) */
  platform: string;

  /** When the request was received */
  timestamp: Date;
}

// =============================================================================
// Extraction
// =============================================================================

/**
 * Extract trace context from an incoming request
 * Combines client-provided headers with server-generated values
 */
export function extractTraceContext(
  request: NextRequest,
  userId: string
): TraceContext {
  const headers = request.headers;

  // Client-provided values (with fallbacks)
  const traceId = headers.get("x-trace-id") || randomUUID();
  const sessionId = headers.get("x-session-id") || "unknown";
  const entryPoint = headers.get("x-entry-point") || "unknown";
  const appVersion = headers.get("x-app-version") || "unknown";
  const platform = headers.get("x-platform") || "unknown";

  // Server-generated values
  const requestId = randomUUID();
  const timestamp = new Date();

  return {
    traceId,
    sessionId,
    userId,
    entryPoint,
    requestId,
    appVersion,
    platform,
    timestamp,
  };
}

/**
 * Create a fallback trace context when headers aren't available
 * (e.g., for internal calls or testing)
 */
export function createFallbackTraceContext(userId: string): TraceContext {
  return {
    traceId: randomUUID(),
    sessionId: "server-generated",
    userId,
    entryPoint: "internal",
    requestId: randomUUID(),
    appVersion: "server",
    platform: "server",
    timestamp: new Date(),
  };
}

/**
 * Serialize trace context for logging
 */
export function serializeTraceContext(ctx: TraceContext): Record<string, string> {
  return {
    trace_id: ctx.traceId,
    session_id: ctx.sessionId,
    user_id: ctx.userId,
    entry_point: ctx.entryPoint,
    request_id: ctx.requestId,
    app_version: ctx.appVersion,
    platform: ctx.platform,
    timestamp: ctx.timestamp.toISOString(),
  };
}
