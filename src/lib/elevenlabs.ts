/**
 * Eleven Labs TTS Service
 *
 * Converts text to speech audio using Eleven Labs API.
 * Configuration matches iOS app settings for voice consistency.
 */

export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
}

export interface TTSRequest {
  text: string;
  model_id: string;
  voice_settings: VoiceSettings;
}

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: string
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.5,
  similarity_boost: 0.75,
};

const BASE_URL = "https://api.elevenlabs.io/v1";

function getConfig() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "c6SfcYrb2t09NHXiT80T";
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_monolingual_v1";

  if (!apiKey) {
    throw new ElevenLabsError(
      "ELEVENLABS_API_KEY environment variable is not set"
    );
  }

  return { apiKey, voiceId, modelId };
}

/**
 * Generate audio from text using Eleven Labs TTS
 * Returns Buffer containing MP3 audio data
 */
export async function textToSpeech(text: string): Promise<Buffer> {
  const config = getConfig();
  const endpoint = `${BASE_URL}/text-to-speech/${config.voiceId}`;

  const requestBody: TTSRequest = {
    text,
    model_id: config.modelId,
    voice_settings: DEFAULT_VOICE_SETTINGS,
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "xi-api-key": config.apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorJson = await response.json();
      if (errorJson?.detail?.message) {
        errorMessage = errorJson.detail.message;
      } else if (typeof errorJson?.detail === "string") {
        errorMessage = errorJson.detail;
      }
    } catch {
      // Ignore JSON parse errors
    }

    if (response.status === 429) {
      throw new ElevenLabsError("Rate limit exceeded", 429, errorMessage);
    }

    throw new ElevenLabsError(
      `Eleven Labs API error: ${errorMessage}`,
      response.status
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Assemble text script from reading plan day fields
 * Combines all text fields with appropriate pauses/transitions
 */
export function assembleReadingPlanScript(day: {
  title?: string | null;
  summary?: string | null;
  contextIntro?: string | null;
  reflectionPrompt?: string | null;
  prayerPrompt?: string | null;
}): string {
  const parts: string[] = [];

  if (day.title) {
    parts.push(day.title);
  }

  if (day.summary) {
    parts.push(day.summary);
  }

  if (day.contextIntro) {
    parts.push("Background and context.");
    parts.push(day.contextIntro);
  }

  if (day.reflectionPrompt) {
    parts.push("Reflection prompt.");
    parts.push(day.reflectionPrompt);
  }

  if (day.prayerPrompt) {
    parts.push("Prayer prompt.");
    parts.push(day.prayerPrompt);
  }

  // Join with pauses (periods create natural pauses in TTS)
  return parts.join("... ");
}
