import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { BRIEF_COLLECTION, sealJson } from "@/lib/heartbeat/crypto";
import { nextSendTime } from "@/lib/heartbeat/rules";
import type { BriefKeyVault } from "@/lib/heartbeat/kms";
import type { Brief } from "@/lib/heartbeat/schemas";
import type { Claimed, HeartbeatStore, OutboxRow, PutBriefResult, RunInput, RunRecord, StateInput, StateRow } from "@/lib/heartbeat/store";

/**
 * Test doubles: an in-memory store that behaves like the SQL one (claims with a lease, a brief write
 * that loses to a newer one, outbox items only while their grant stands) and a KMS that binds a
 * wrapped key to the user it was wrapped for, as the encryption context does.
 */

export class FakeKms implements BriefKeyVault {
  private master = randomBytes(32);
  /** Every key handed out by `unwrap`, so a test can check it was zeroed afterwards. */
  readonly unwrapped: Buffer[] = [];
  readonly unwrapCalls: string[] = [];
  readonly wrapCalls: string[] = [];
  failFor = new Set<string>();

  async wrap(userId: string, key: Buffer): Promise<string> {
    this.wrapCalls.push(userId);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.master, nonce);
    cipher.setAAD(Buffer.from(userId));
    const body = Buffer.concat([cipher.update(key), cipher.final()]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64");
  }

  async unwrap(userId: string, wrapped: string): Promise<Buffer> {
    this.unwrapCalls.push(userId);
    if (this.failFor.has(userId)) throw new Error("kms down");
    const data = Buffer.from(wrapped, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.master, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(data.subarray(data.length - 16));
    const key = Buffer.concat([decipher.update(data.subarray(12, data.length - 16)), decipher.final()]);
    this.unwrapped.push(key);
    return key;
  }
}

type StateData = StateRow & { claimedUntil: Date | null; lastHeadsUpDay?: string | null };
type BriefData = { ciphertext: string; keyId: string; deviceWrittenAt: Date; revision: number; receivedAt: Date | null };
type OutboxData = OutboxRow & { userId: string };

export class MemoryStore implements HeartbeatStore {
  states = new Map<string, StateData>();
  grants = new Map<string, { wrappedKey: string; keyId: string; expiresAt: Date }>();
  briefs = new Map<string, BriefData>();
  outbox: OutboxData[] = [];
  runs: RunRecord[] = [];
  private nextId = 1;
  /** Make `finishRun` throw for these users. */
  failFinish = new Set<string>();

  async getState(userId: string) {
    return this.states.get(userId) ?? null;
  }

  async putState(userId: string, input: StateInput, now: Date) {
    const current = this.states.get(userId);
    const soonest = nextSendTime(input.sendTimes ?? [], now);
    const nextBeatAt = current && soonest && soonest < current.nextBeatAt ? soonest : current?.nextBeatAt ?? now;
    const row: StateData = {
      ...input,
      sendTimes: input.sendTimes ?? [],
      pausedUntil: input.pausedUntil ?? null,
      lastHeadsUpDay: current?.lastHeadsUpDay ?? null,
      nextBeatAt,
      lastBeatAt: current?.lastBeatAt ?? null,
      claimedUntil: current?.claimedUntil ?? null,
    };
    this.states.set(userId, row);
    return row;
  }

  async getGrant(userId: string) {
    const g = this.grants.get(userId);
    return g ? { keyId: g.keyId, expiresAt: g.expiresAt } : null;
  }

  async putGrant(userId: string, grant: { wrappedKey: string; keyId: string; expiresAt: Date }) {
    if (!this.states.has(userId)) return false;
    this.grants.set(userId, grant);
    return true;
  }

  async putBrief(userId: string, brief: { ciphertext: string; keyId: string; deviceWrittenAt: Date }, now: Date): Promise<PutBriefResult> {
    const grant = this.grants.get(userId);
    if (!grant) return "no_grant";
    if (grant.keyId !== brief.keyId) return "key_mismatch";
    this.briefs.set(userId, { ...brief, receivedAt: now, revision: (this.briefs.get(userId)?.revision ?? 0) + 1 });
    return "ok";
  }

  async deleteGrantData(userId: string) {
    this.grants.delete(userId);
    this.briefs.delete(userId);
    this.outbox = this.outbox.filter((o) => o.userId !== userId);
  }

  async listOutbox(userId: string, limit: number) {
    return this.outbox.filter((o) => o.userId === userId).slice(0, limit);
  }

  async ackOutbox(userId: string, ids: string[]) {
    const before = this.outbox.length;
    this.outbox = this.outbox.filter((o) => !(o.userId === userId && ids.includes(o.id)));
    return before - this.outbox.length;
  }

  async claimDue(now: Date, writtenAfter: Date, limit: number, leaseUntil: Date): Promise<Claimed[]> {
    const picked = [...this.states.entries()]
      .filter(([userId, s]) => {
        const g = this.grants.get(userId);
        const b = this.briefs.get(userId);
        return (
          s.enabled &&
          s.nextBeatAt <= now &&
          (!s.claimedUntil || s.claimedUntil <= now) &&
          g !== undefined &&
          g.expiresAt > now &&
          b !== undefined &&
          b.deviceWrittenAt > writtenAfter
        );
      })
      .sort((a, b) => a[1].nextBeatAt.getTime() - b[1].nextBeatAt.getTime())
      .slice(0, limit);
    // Synchronous, like the single SQL statement: nothing can claim between the pick and the lease.
    for (const [, s] of picked) s.claimedUntil = leaseUntil;
    return picked.map(([userId, s]) => ({ userId, timezone: s.timezone, quietStart: s.quietStart, quietEnd: s.quietEnd, sendTimes: s.sendTimes }));
  }

  async findLapsed(now: Date, writtenBefore: Date, limit: number) {
    const ids = new Set<string>();
    for (const [userId, g] of this.grants) if (g.expiresAt <= now) ids.add(userId);
    for (const [userId, b] of this.briefs) if (b.deviceWrittenAt <= writtenBefore) ids.add(userId);
    return [...ids].slice(0, limit);
  }

  async loadForRun(userId: string): Promise<RunInput | null> {
    const state = this.states.get(userId);
    if (!state) return null;
    return {
      grant: this.grants.get(userId) ?? null,
      brief: this.briefs.get(userId) ?? null,
      outboxCount: this.outbox.filter((o) => o.userId === userId).length,
      pushEnabled: state.pushEnabled,
      pausedUntil: state.pausedUntil,
      lastHeadsUpDay: state.lastHeadsUpDay ?? null,
    };
  }

  async finishRun(
    userId: string,
    result: { now: Date; nextBeatAt: Date; brief?: { ciphertext: string; expectedRevision: number }; outbox?: Array<{ ciphertext: string; keyId: string }> }
  ) {
    if (this.failFinish.has(userId)) throw new Error("database down");
    let briefWritten = false;
    const current = this.briefs.get(userId);
    if (result.brief && current && current.revision === result.brief.expectedRevision) {
      this.briefs.set(userId, { ...current, ciphertext: result.brief.ciphertext, revision: current.revision + 1 });
      briefWritten = true;
    }
    for (const item of result.outbox ?? []) {
      if (this.grants.get(userId)?.keyId === item.keyId) {
        this.outbox.push({ id: `o${this.nextId++}`, userId, ciphertext: item.ciphertext, keyId: item.keyId, createdAt: result.now });
      }
    }
    const s = this.states.get(userId);
    if (s) Object.assign(s, { nextBeatAt: result.nextBeatAt, lastBeatAt: result.now, claimedUntil: null });
    return { briefWritten };
  }

  async release(userId: string, nextBeatAt: Date) {
    const s = this.states.get(userId);
    if (s) Object.assign(s, { nextBeatAt, claimedUntil: null });
  }

  async claimHeadsUpDay(userId: string, day: string) {
    const s = this.states.get(userId);
    if (!s || s.lastHeadsUpDay === day) return false;
    s.lastHeadsUpDay = day;
    return true;
  }

  async recordRun(run: RunRecord) {
    this.runs.push(run);
  }
}

/** A user who is due: state, an unexpired grant under a fresh key, and the brief sealed with it. */
export function seedUser(
  store: MemoryStore,
  kms: FakeKms,
  options: { userId: string; brief: Brief; now: Date; keyId?: string; nextBeatAt?: Date; quiet?: { start: string; end: string }; pushEnabled?: boolean }
): Promise<{ key: Buffer; keyId: string }> {
  const { userId, brief, now } = options;
  const key = randomBytes(32);
  const keyId = options.keyId ?? "k1";
  return kms.wrap(userId, key).then(async (wrappedKey) => {
    store.states.set(userId, {
      enabled: true,
      timezone: brief.person.timezone,
      quietStart: options.quiet?.start ?? brief.person.quietHours.start,
      quietEnd: options.quiet?.end ?? brief.person.quietHours.end,
      pushEnabled: options.pushEnabled ?? false,
      sendTimes: [],
      pausedUntil: null,
      nextBeatAt: options.nextBeatAt ?? new Date(now.getTime() - 3_600_000),
      lastBeatAt: null,
      claimedUntil: null,
    });
    store.grants.set(userId, { wrappedKey, keyId, expiresAt: new Date(now.getTime() + 10 * 86_400_000) });
    store.briefs.set(userId, {
      ciphertext: sealJson(key, userId, BRIEF_COLLECTION, brief),
      keyId,
      deviceWrittenAt: new Date(now.getTime() - 3_600_000),
      receivedAt: new Date(now.getTime() - 3_600_000),
      revision: 1,
    });
    return { key, keyId };
  });
}
