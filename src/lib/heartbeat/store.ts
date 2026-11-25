/**
 * Everything the heartbeat keeps in the database, behind one small interface. The routes and the run
 * only talk to this, so tests use an in-memory store and nothing here needs a database to be checked.
 * What is stored is metadata and ciphertext only (see the schema comments): no method takes or
 * returns readable content.
 */

export type StateInput = {
  enabled: boolean;
  timezone: string;
  quietStart: string;
  quietEnd: string;
  pushEnabled: boolean;
  /** The next heads-up send times, from the device. Absent means none. */
  sendTimes?: Date[];
  pausedUntil?: Date | null;
};
export type StateRow = Required<StateInput> & { nextBeatAt: Date; lastBeatAt: Date | null };

export type GrantInfo = { keyId: string; expiresAt: Date };

export type PutBriefResult = "ok" | "no_grant" | "key_mismatch";

export type OutboxRow = { id: string; keyId: string; ciphertext: string; createdAt: Date };

/** A user claimed for a run. The lease (`claimedUntil`) keeps any other run away until it is released. */
export type Claimed = { userId: string; timezone: string; quietStart: string; quietEnd: string; sendTimes: Date[] };

/** What a run reads for one user. The wrapped key is the only key material, and it is not plain. */
export type RunInput = {
  grant: { wrappedKey: string; keyId: string; expiresAt: Date } | null;
  /** `receivedAt` is when a device last wrote it, by the server's clock (null before that was kept). */
  brief: { ciphertext: string; keyId: string; deviceWrittenAt: Date; revision: number; receivedAt: Date | null } | null;
  outboxCount: number;
  /** The user's push switch (state), read with the rest of the run's input. */
  pushEnabled: boolean;
  pausedUntil: Date | null;
  /** The local day a heads-up was last pushed, YYYY-MM-DD. */
  lastHeadsUpDay: string | null;
};

export type RunRecord = {
  userId: string;
  trigger: string;
  /** A code. Never text. */
  outcome: string;
  staleness?: string;
  modelCalled: boolean;
  posts: number;
  activities: number;
  dropped: number;
  /** Pushes APNs accepted in this run (a count, 0 or 1). */
  pushed: number;
  durationMs: number;
};

export interface HeartbeatStore {
  // MARK: Device-facing
  getState(userId: string): Promise<StateRow | null>;
  /** Creates the state (first beat due now) or updates it. A send time sooner than the next beat brings the beat forward to it. */
  putState(userId: string, input: StateInput, now: Date): Promise<StateRow>;
  getGrant(userId: string): Promise<GrantInfo | null>;
  /** Stores or replaces the wrapped key. False when the user has no state yet. */
  putGrant(userId: string, grant: { wrappedKey: string; keyId: string; expiresAt: Date }, now: Date): Promise<boolean>;
  /** Stores the brief if the user has a grant under the same key id. */
  putBrief(userId: string, brief: { ciphertext: string; keyId: string; deviceWrittenAt: Date }, now: Date): Promise<PutBriefResult>;
  /** The wrapped key, the brief and the outbox, at once. */
  deleteGrantData(userId: string): Promise<void>;
  listOutbox(userId: string, limit: number): Promise<OutboxRow[]>;
  ackOutbox(userId: string, ids: string[]): Promise<number>;

  // MARK: Cron
  /** Users that are enabled, hold an unexpired grant and a brief written after `writtenAfter`, and are due. Leased until `leaseUntil`. */
  claimDue(now: Date, writtenAfter: Date, limit: number, leaseUntil: Date): Promise<Claimed[]>;
  /** Users whose grant has expired or whose brief was last written by a device before `writtenBefore`. */
  findLapsed(now: Date, writtenBefore: Date, limit: number): Promise<string[]>;
  loadForRun(userId: string): Promise<RunInput | null>;
  /**
   * Ends a run: stores the new brief only if nobody wrote one since `expectedRevision` (a device write
   * wins), adds outbox items only while the grant they were encrypted under still stands, sets when to
   * look again and releases the lease. Returns whether the brief was written.
   */
  finishRun(
    userId: string,
    result: {
      now: Date;
      nextBeatAt: Date;
      brief?: { ciphertext: string; expectedRevision: number };
      outbox?: Array<{ ciphertext: string; keyId: string }>;
    }
  ): Promise<{ briefWritten: boolean }>;
  /** Puts a user back with a time to look again, without any other change. Also how quiet hours defer. */
  release(userId: string, nextBeatAt: Date, now: Date): Promise<void>;
  /** Records the heads-up push for a local day. False when one was already recorded for that day: at most one a day, even if two runs race. */
  claimHeadsUpDay(userId: string, day: string, now: Date): Promise<boolean>;
  recordRun(run: RunRecord, now: Date): Promise<void>;
}
