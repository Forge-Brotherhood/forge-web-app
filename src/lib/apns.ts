import { sign } from "node:crypto";
import { connect, type IncomingHttpHeaders, type OutgoingHttpHeaders } from "node:http2";
import { prisma } from "@/lib/prisma";

/**
 * Push straight to Apple's push service (APNs) with token auth (a .p8 key). No other party sits in
 * between: Apple sees the alert, the data fields and the device token, nothing else does.
 *
 * Debug builds get tokens for Apple's sandbox, App Store and TestFlight builds get production ones,
 * and a token does not say which it is. So every token goes to production first, and a token
 * production calls a bad device token is tried once on the sandbox. Each host has its own key,
 * since an APNs key can be limited to one of them (a key for both is set for both).
 *
 * Privacy: logs carry a status and Apple's reason code, never a token or any text.
 */

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

export interface PushResult {
  successCount: number;
  failedTokens: string[];
}

export type ApnsHost = {
  url: string;
  keyId: string;
  /** The .p8 key, PEM. */
  privateKey: string;
};

export type ApnsConfig = {
  teamId: string;
  /** The app's bundle id (the push topic). */
  bundleId: string;
  /** Tried in order; a token goes to the next only when one calls it a bad device token. */
  hosts: readonly ApnsHost[];
};

/** An APNs device token is hex. Anything else (an old FCM token, say) can never be delivered. */
const APNS_TOKEN = /^[0-9a-f]+$/i;
const REQUEST_TIMEOUT_MS = 10_000;
/** Apple wants a new provider token at most every 20 minutes and at least every 60. */
const PROVIDER_TOKEN_LIFETIME_MS = 50 * 60 * 1000;

/** A host whose key id and key are both set, or none. */
function hostFromEnv(url: string, keyId: string | undefined, privateKey: string | undefined): ApnsHost[] {
  return keyId && privateKey ? [{ url, keyId, privateKey: privateKey.replace(/\\n/g, "\n") }] : [];
}

function configFromEnv(): ApnsConfig | null {
  const teamId = process.env.APNS_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  const hosts = [
    ...hostFromEnv("https://api.push.apple.com", process.env.APNS_KEY_ID, process.env.APNS_PRIVATE_KEY),
    ...hostFromEnv("https://api.sandbox.push.apple.com", process.env.APNS_SANDBOX_KEY_ID, process.env.APNS_SANDBOX_PRIVATE_KEY),
  ];

  if (!teamId || !bundleId || hosts.length === 0) {
    console.warn("APNs credentials not configured. Push notifications disabled.");
    return null;
  }
  return { teamId, bundleId, hosts };
}

const providerTokens = new Map<string, { token: string; issuedAt: number }>();

/** The ES256 JWT that authorizes a request with this key, reused for 50 minutes. */
function providerToken(teamId: string, host: ApnsHost, now = Date.now()): string {
  const key = `${teamId}/${host.keyId}`;
  const cached = providerTokens.get(key);
  if (cached && now - cached.issuedAt < PROVIDER_TOKEN_LIFETIME_MS) return cached.token;

  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${part({ alg: "ES256", kid: host.keyId })}.${part({ iss: teamId, iat: Math.floor(now / 1000) })}`;
  const signature = sign("sha256", Buffer.from(input), { key: host.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const token = `${input}.${signature}`;
  providerTokens.set(key, { token, issuedAt: now });
  return token;
}

/**
 * The JSON Apple delivers. Data fields sit at the top level, where the app reads them from
 * `userInfo`; `mutable-content` lets the notification service extension change the alert.
 */
export function apnsBody(payload: PushPayload): string {
  return JSON.stringify({
    ...payload.data,
    ...(payload.imageUrl ? { image: payload.imageUrl } : {}),
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
      badge: 1,
      "mutable-content": 1,
    },
  });
}

type Reply = { status: number; reason?: string };

function reasonIn(body: string): string | undefined {
  try {
    const reason = (JSON.parse(body) as { reason?: unknown }).reason;
    return typeof reason === "string" ? reason : undefined;
  } catch {
    return undefined;
  }
}

/** Sends the body to each token over one HTTP/2 connection. A reply of status 0 means no answer. */
async function sendToHost(host: string, tokens: string[], headers: OutgoingHttpHeaders, body: string): Promise<Reply[]> {
  const session = connect(host);
  session.on("error", () => undefined); // each request reports its own failure
  try {
    return await Promise.all(
      tokens.map(
        (token) =>
          new Promise<Reply>((resolve) => {
            const request = session.request({ ...headers, ":method": "POST", ":path": `/3/device/${token}` });
            let status = 0;
            let data = "";
            request.setEncoding("utf8");
            request.on("response", (h: IncomingHttpHeaders) => (status = Number(h[":status"])));
            request.on("data", (chunk: string) => (data += chunk));
            request.on("end", () => resolve({ status, reason: reasonIn(data) }));
            request.on("error", () => resolve({ status: 0 }));
            request.setTimeout(REQUEST_TIMEOUT_MS, () => {
              request.close();
              resolve({ status: 0 });
            });
            request.end(body);
          })
      )
    );
  } finally {
    session.close();
  }
}

/** Sends with the given config. Never throws. */
export async function sendPushWith(config: ApnsConfig, tokens: string[], payload: PushPayload): Promise<PushResult> {
  const failedTokens = tokens.filter((token) => !APNS_TOKEN.test(token));
  let pending = tokens.filter((token) => APNS_TOKEN.test(token));
  let successCount = 0;

  try {
    const body = apnsBody(payload);

    for (const host of config.hosts) {
      if (pending.length === 0) break;
      const headers = {
        authorization: `bearer ${providerToken(config.teamId, host)}`,
        "apns-topic": config.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
      };
      const replies = await sendToHost(host.url, pending, headers, body);
      const wrongHost: string[] = [];
      pending.forEach((token, i) => {
        const { status, reason } = replies[i];
        if (status === 200) successCount++;
        // A sandbox token sent to production (or the reverse) is a bad device token there.
        else if (reason === "BadDeviceToken") wrongHost.push(token);
        // The app was removed or the token is no longer valid.
        else if (status === 410) failedTokens.push(token);
        else {
          // The key or its id no longer works: make a new provider token next time.
          if (status === 403) providerTokens.delete(`${config.teamId}/${host.keyId}`);
          console.error(`APNs send failed: ${status} ${reason ?? ""}`.trim());
        }
      });
      pending = wrongHost;
    }
    // Bad on every host.
    failedTokens.push(...pending);
  } catch (error) {
    console.error("Failed to send push notification:", error instanceof Error ? error.message : "unknown error");
  }

  return { successCount, failedTokens };
}

/**
 * Send push notification to multiple device tokens
 */
export async function sendPushNotification(tokens: string[], payload: PushPayload): Promise<PushResult> {
  if (tokens.length === 0) {
    return { successCount: 0, failedTokens: [] };
  }
  const config = configFromEnv();
  if (!config) {
    return { successCount: 0, failedTokens: [] };
  }
  return sendPushWith(config, tokens, payload);
}

/**
 * Mark invalid tokens as inactive in the database
 */
export async function cleanupInvalidTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;

  try {
    await prisma.pushToken.updateMany({
      where: { token: { in: tokens } },
      data: { isActive: false },
    });
    console.log(`Deactivated ${tokens.length} invalid push tokens`);
  } catch (error) {
    console.error("Failed to cleanup invalid tokens:", error);
  }
}
