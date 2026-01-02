/**
 * AI Debug Envelope Builder
 *
 * Fluent API for building debug envelopes through the AI pipeline.
 * Call methods as you progress through each stage.
 */

import type { TraceContext } from "./traceContext";
import type {
  AIDebugEnvelope,
  ContextReport,
  ConversationCompaction,
  PromptArtifacts,
  ModelCallInfo,
  PostProcessingInfo,
  ResponseInfo,
  ReplayData,
  ExclusionReason,
} from "./debugEnvelope";
import { estimateTokens, hashString, truncatePreview } from "./debugEnvelope";

// =============================================================================
// Builder Class
// =============================================================================

export class AIDebugEnvelopeBuilder {
  private envelope: Partial<AIDebugEnvelope>;
  private startTime: number;

  constructor(traceContext: TraceContext) {
    this.startTime = Date.now();
    this.envelope = {
      traceId: traceContext.traceId,
      requestId: traceContext.requestId,
      sessionId: traceContext.sessionId,
      userId: traceContext.userId,
      timestamp: traceContext.timestamp.toISOString(),
      entryPoint: traceContext.entryPoint,
      appVersion: traceContext.appVersion,
      platform: traceContext.platform,
    };
  }

  // ===========================================================================
  // Intent & Inputs
  // ===========================================================================

  /**
   * Set the user's message/question
   */
  setUserMessage(message: string): this {
    this.envelope.userMessage = message;
    return this;
  }

  /**
   * Set verse reference and optional text
   */
  setVerseContext(reference: string, text?: string): this {
    this.envelope.verseReference = reference;
    if (text) {
      this.envelope.verseText = text;
    }
    return this;
  }

  /**
   * Set selected content context
   */
  setSelectedContent(
    type: "verse" | "chapter",
    reference: string,
    verseNumbers?: number[]
  ): this {
    this.envelope.selectedContent = { type, reference, verseNumbers };
    return this;
  }

  // ===========================================================================
  // Context Assembly
  // ===========================================================================

  /**
   * Set the context report from memory pipeline
   */
  setContextReport(report: Partial<ContextReport>): this {
    this.envelope.contextReport = {
      memoriesQueried: report.memoriesQueried ?? 0,
      memoriesIncluded: report.memoriesIncluded ?? 0,
      memoriesIncludedDetails: report.memoriesIncludedDetails,
      memoryPromptAddition: report.memoryPromptAddition,
      memoriesExcluded: report.memoriesExcluded ?? [],
      intentClassification: report.intentClassification ?? {
        intent: "unknown",
        confidence: 0,
        signals: [],
      },
      usageMode: report.usageMode ?? "silent",
      lifeContextUsed: report.lifeContextUsed ?? false,
      tokenCounts: report.tokenCounts ?? {
        systemPrompt: 0,
        userContext: 0,
        conversationHistory: 0,
        total: 0,
      },
    };
    return this;
  }

  /**
   * Add a memory exclusion reason
   */
  addMemoryExclusion(
    id: string,
    reason: ExclusionReason,
    verseReference?: string,
    details?: string
  ): this {
    if (!this.envelope.contextReport) {
      this.setContextReport({});
    }
    this.envelope.contextReport!.memoriesExcluded.push({
      id,
      verseReference,
      reason,
      details,
    });
    return this;
  }

  /**
   * Set conversation compaction info
   */
  setConversationCompaction(compaction: ConversationCompaction): this {
    if (!this.envelope.contextReport) {
      this.setContextReport({});
    }
    this.envelope.contextReport!.conversationCompaction = compaction;
    return this;
  }

  // ===========================================================================
  // Prompt Artifacts
  // ===========================================================================

  /**
   * Set prompt artifacts from the assembled prompt
   */
  async setPromptArtifacts(
    systemPrompt: string,
    messages: Array<{ role: string; content: string }>,
    tools: string[] = []
  ): Promise<this> {
    const hash = await hashString(systemPrompt);
    this.envelope.promptArtifacts = {
      systemPromptHash: hash,
      messagesCount: messages.length,
      toolsEnabled: tools,
    };

    // Update token counts
    if (this.envelope.contextReport) {
      this.envelope.contextReport.tokenCounts = {
        systemPrompt: estimateTokens(systemPrompt),
        userContext: estimateTokens(
          messages
            .filter((m) => m.role === "user")
            .map((m) => m.content)
            .join(" ")
        ),
        conversationHistory: estimateTokens(
          messages.map((m) => m.content).join(" ")
        ),
        total: estimateTokens(
          systemPrompt + messages.map((m) => m.content).join(" ")
        ),
      };
    }

    return this;
  }

  // ===========================================================================
  // Model Call
  // ===========================================================================

  /**
   * Set model call information
   */
  setModelCall(info: Partial<ModelCallInfo>): this {
    this.envelope.modelCall = {
      model: info.model ?? "unknown",
      temperature: info.temperature ?? 0,
      maxTokens: info.maxTokens ?? 0,
      latencyMs: info.latencyMs ?? 0,
      inputTokens: info.inputTokens ?? 0,
      outputTokens: info.outputTokens ?? 0,
      finishReason: info.finishReason ?? "unknown",
      toolCallsMade: info.toolCallsMade ?? [],
    };
    return this;
  }

  /**
   * Record model call timing (call when model responds)
   */
  recordModelLatency(startTime: number): this {
    if (this.envelope.modelCall) {
      this.envelope.modelCall.latencyMs = Date.now() - startTime;
    }
    return this;
  }

  // ===========================================================================
  // Post-Processing
  // ===========================================================================

  /**
   * Set post-processing information
   */
  setPostProcessing(info: Partial<PostProcessingInfo>): this {
    this.envelope.postProcessing = {
      actionsExtracted: info.actionsExtracted ?? [],
      followUpCallMade: info.followUpCallMade ?? false,
    };
    return this;
  }

  /**
   * Add an extracted action
   */
  addAction(
    type: string,
    params: Record<string, unknown>,
    validated: boolean,
    dropReason?: string
  ): this {
    if (!this.envelope.postProcessing) {
      this.setPostProcessing({});
    }
    this.envelope.postProcessing!.actionsExtracted.push({
      type,
      params,
      validated,
      dropReason,
    });
    return this;
  }

  // ===========================================================================
  // Response
  // ===========================================================================

  /**
   * Set final response information
   */
  setResponse(
    content: string,
    responseType: "greeting" | "explanation" | "followup",
    actionCount: number = 0
  ): this {
    this.envelope.response = {
      contentLength: content.length,
      contentPreview: truncatePreview(content, 200),
      actionCount,
      responseType,
    };
    return this;
  }

  // ===========================================================================
  // Replay Data
  // ===========================================================================

  /**
   * Set replay data for deterministic replay
   */
  setReplayData(
    messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }>,
    toolSchemas: unknown[],
    modelParams: { model: string; temperature: number; maxTokens: number }
  ): this {
    this.envelope.replayData = {
      fullMessages: messages.map((m) => ({
        role: m.role as "system" | "user" | "assistant" | "tool",
        content: m.content,
        tool_calls: m.tool_calls,
        tool_call_id: m.tool_call_id,
      })),
      toolSchemas,
      modelParams,
    };
    return this;
  }

  // ===========================================================================
  // Build
  // ===========================================================================

  /**
   * Build the final envelope
   * Fills in defaults for any missing fields
   */
  build(): AIDebugEnvelope {
    // Ensure all required fields have defaults
    const envelope: AIDebugEnvelope = {
      traceId: this.envelope.traceId!,
      requestId: this.envelope.requestId!,
      sessionId: this.envelope.sessionId!,
      userId: this.envelope.userId!,
      timestamp: this.envelope.timestamp!,
      entryPoint: this.envelope.entryPoint!,
      appVersion: this.envelope.appVersion!,
      platform: this.envelope.platform!,
      userMessage: this.envelope.userMessage ?? "",
      verseReference: this.envelope.verseReference ?? "",
      verseText: this.envelope.verseText,
      selectedContent: this.envelope.selectedContent,
      contextReport: this.envelope.contextReport ?? {
        memoriesQueried: 0,
        memoriesIncluded: 0,
        memoriesExcluded: [],
        intentClassification: { intent: "unknown", confidence: 0, signals: [] },
        usageMode: "silent",
        lifeContextUsed: false,
        tokenCounts: {
          systemPrompt: 0,
          userContext: 0,
          conversationHistory: 0,
          total: 0,
        },
      },
      promptArtifacts: this.envelope.promptArtifacts ?? {
        systemPromptHash: "",
        messagesCount: 0,
        toolsEnabled: [],
      },
      modelCall: this.envelope.modelCall ?? {
        model: "unknown",
        temperature: 0,
        maxTokens: 0,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        finishReason: "unknown",
        toolCallsMade: [],
      },
      postProcessing: this.envelope.postProcessing ?? {
        actionsExtracted: [],
        followUpCallMade: false,
      },
      response: this.envelope.response ?? {
        contentLength: 0,
        contentPreview: "",
        actionCount: 0,
        responseType: "followup",
      },
      replayData: this.envelope.replayData ?? {
        fullMessages: [],
        toolSchemas: [],
        modelParams: { model: "unknown", temperature: 0, maxTokens: 0 },
      },
    };

    return envelope;
  }

  /**
   * Get the total elapsed time since builder creation
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }
}
