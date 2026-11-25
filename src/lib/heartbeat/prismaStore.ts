import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Claimed, GrantInfo, HeartbeatStore, OutboxRow, RunInput, StateRow } from "@/lib/heartbeat/store";

/**
 * The database side of `HeartbeatStore`. It is written as raw SQL on purpose: the claim needs
 * `FOR UPDATE SKIP LOCKED`, and raw queries do not depend on the generated client having the
 * Heartbeat models. Table and column names are those of migration 20261124_heartbeat.
 *
 * Only ciphertext, ids, times, flags, counts and codes pass through here.
 */

export const prismaHeartbeatStore: HeartbeatStore = {
  async getState(userId) {
    const rows = await prisma.$queryRaw<StateRow[]>`
      SELECT "enabled", "timezone", "quietStart", "quietEnd", "pushEnabled", "sendTimes", "pausedUntil", "nextBeatAt", "lastBeatAt"
      FROM "HeartbeatState" WHERE "userId" = ${userId}`;
    return rows[0] ?? null;
  },

  async putState(userId, input, now) {
    const rows = await prisma.$queryRaw<StateRow[]>`
      INSERT INTO "HeartbeatState" ("userId", "enabled", "timezone", "quietStart", "quietEnd", "pushEnabled", "sendTimes", "pausedUntil", "nextBeatAt", "createdAt", "updatedAt")
      VALUES (${userId}, ${input.enabled}, ${input.timezone}, ${input.quietStart}, ${input.quietEnd}, ${input.pushEnabled},
        ${input.sendTimes ?? []}::timestamp(3)[], ${input.pausedUntil ?? null}, ${now}, ${now}, ${now})
      ON CONFLICT ("userId") DO UPDATE SET
        "enabled" = EXCLUDED."enabled", "timezone" = EXCLUDED."timezone", "quietStart" = EXCLUDED."quietStart",
        "quietEnd" = EXCLUDED."quietEnd", "pushEnabled" = EXCLUDED."pushEnabled", "sendTimes" = EXCLUDED."sendTimes",
        "pausedUntil" = EXCLUDED."pausedUntil", "updatedAt" = EXCLUDED."updatedAt"
      RETURNING "enabled", "timezone", "quietStart", "quietEnd", "pushEnabled", "sendTimes", "pausedUntil", "nextBeatAt", "lastBeatAt"`;
    return rows[0];
  },

  async getGrant(userId) {
    const rows = await prisma.$queryRaw<GrantInfo[]>`
      SELECT "keyId", "expiresAt" FROM "HeartbeatGrant" WHERE "userId" = ${userId}`;
    return rows[0] ?? null;
  },

  async putGrant(userId, grant, now) {
    const count = await prisma.$executeRaw`
      INSERT INTO "HeartbeatGrant" ("userId", "wrappedKey", "keyId", "expiresAt", "createdAt", "updatedAt")
      SELECT ${userId}, ${grant.wrappedKey}, ${grant.keyId}, ${grant.expiresAt}, ${now}, ${now}
      WHERE EXISTS (SELECT 1 FROM "HeartbeatState" WHERE "userId" = ${userId})
      ON CONFLICT ("userId") DO UPDATE SET
        "wrappedKey" = EXCLUDED."wrappedKey", "keyId" = EXCLUDED."keyId", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = EXCLUDED."updatedAt"`;
    return count > 0;
  },

  async putBrief(userId, brief, now) {
    const grant = await prismaHeartbeatStore.getGrant(userId);
    if (!grant) return "no_grant";
    if (grant.keyId !== brief.keyId) return "key_mismatch";
    // The grant is checked again in the statement itself, in case it was revoked or rotated just now.
    const count = await prisma.$executeRaw`
      INSERT INTO "HeartbeatBrief" ("userId", "ciphertext", "keyId", "deviceWrittenAt", "revision", "createdAt", "updatedAt")
      SELECT ${userId}, ${brief.ciphertext}, ${brief.keyId}, ${brief.deviceWrittenAt}, 1, ${now}, ${now}
      WHERE EXISTS (SELECT 1 FROM "HeartbeatGrant" WHERE "userId" = ${userId} AND "keyId" = ${brief.keyId})
      ON CONFLICT ("userId") DO UPDATE SET
        "ciphertext" = EXCLUDED."ciphertext", "keyId" = EXCLUDED."keyId", "deviceWrittenAt" = EXCLUDED."deviceWrittenAt",
        "revision" = "HeartbeatBrief"."revision" + 1, "updatedAt" = EXCLUDED."updatedAt"`;
    return count > 0 ? "ok" : "no_grant";
  },

  async deleteGrantData(userId) {
    await prisma.$transaction([
      prisma.$executeRaw`DELETE FROM "HeartbeatGrant" WHERE "userId" = ${userId}`,
      prisma.$executeRaw`DELETE FROM "HeartbeatBrief" WHERE "userId" = ${userId}`,
      prisma.$executeRaw`DELETE FROM "HeartbeatOutbox" WHERE "userId" = ${userId}`,
    ]);
  },

  async listOutbox(userId, limit) {
    return prisma.$queryRaw<OutboxRow[]>`
      SELECT "id", "keyId", "ciphertext", "createdAt" FROM "HeartbeatOutbox"
      WHERE "userId" = ${userId} ORDER BY "createdAt" ASC, "id" ASC LIMIT ${limit}`;
  },

  async ackOutbox(userId, ids) {
    if (ids.length === 0) return 0;
    return prisma.$executeRaw`DELETE FROM "HeartbeatOutbox" WHERE "userId" = ${userId} AND "id" = ANY(${ids}::text[])`;
  },

  // One statement: the rows are picked with SKIP LOCKED and leased in the same breath, so two
  // overlapping runs never get the same user. A lease that was never released (a crashed run) expires.
  async claimDue(now, writtenAfter, limit, leaseUntil) {
    return prisma.$queryRaw<Claimed[]>`
      WITH picked AS MATERIALIZED (
        SELECT s."userId" FROM "HeartbeatState" s
        JOIN "HeartbeatGrant" g ON g."userId" = s."userId"
        JOIN "HeartbeatBrief" b ON b."userId" = s."userId"
        WHERE s."enabled" = true
          AND s."nextBeatAt" <= ${now}
          AND (s."claimedUntil" IS NULL OR s."claimedUntil" <= ${now})
          AND g."expiresAt" > ${now}
          AND b."deviceWrittenAt" > ${writtenAfter}
        ORDER BY s."nextBeatAt" ASC
        LIMIT ${limit}
        FOR UPDATE OF s SKIP LOCKED
      )
      UPDATE "HeartbeatState" st SET "claimedUntil" = ${leaseUntil}
      FROM picked WHERE st."userId" = picked."userId"
      RETURNING st."userId", st."timezone", st."quietStart", st."quietEnd"`;
  },

  async findLapsed(now, writtenBefore, limit) {
    const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
      SELECT u."userId" FROM (
        SELECT "userId" FROM "HeartbeatGrant" WHERE "expiresAt" <= ${now}
        UNION
        SELECT "userId" FROM "HeartbeatBrief" WHERE "deviceWrittenAt" <= ${writtenBefore}
      ) u LIMIT ${limit}`;
    return rows.map((r) => r.userId);
  },

  async loadForRun(userId): Promise<RunInput | null> {
    const state = await prismaHeartbeatStore.getState(userId);
    if (!state) return null;
    const grants = await prisma.$queryRaw<NonNullable<RunInput["grant"]>[]>`
      SELECT "wrappedKey", "keyId", "expiresAt" FROM "HeartbeatGrant" WHERE "userId" = ${userId}`;
    const briefs = await prisma.$queryRaw<NonNullable<RunInput["brief"]>[]>`
      SELECT "ciphertext", "keyId", "deviceWrittenAt", "revision" FROM "HeartbeatBrief" WHERE "userId" = ${userId}`;
    const counts = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS "n" FROM "HeartbeatOutbox" WHERE "userId" = ${userId}`;
    return { grant: grants[0] ?? null, brief: briefs[0] ?? null, outboxCount: counts[0]?.n ?? 0, pushEnabled: state.pushEnabled };
  },

  async finishRun(userId, result) {
    const statements = [];
    if (result.brief) {
      statements.push(prisma.$executeRaw`
        UPDATE "HeartbeatBrief" SET "ciphertext" = ${result.brief.ciphertext}, "revision" = "revision" + 1, "updatedAt" = ${result.now}
        WHERE "userId" = ${userId} AND "revision" = ${result.brief.expectedRevision}`);
    }
    for (const item of result.outbox ?? []) {
      // Only while the grant the item was encrypted under still stands: nothing is added after a revoke.
      statements.push(prisma.$executeRaw`
        INSERT INTO "HeartbeatOutbox" ("id", "userId", "ciphertext", "keyId", "createdAt")
        SELECT ${randomUUID()}, ${userId}, ${item.ciphertext}, ${item.keyId}, ${result.now}
        WHERE EXISTS (SELECT 1 FROM "HeartbeatGrant" WHERE "userId" = ${userId} AND "keyId" = ${item.keyId})`);
    }
    statements.push(prisma.$executeRaw`
      UPDATE "HeartbeatState" SET "nextBeatAt" = ${result.nextBeatAt}, "lastBeatAt" = ${result.now}, "claimedUntil" = NULL, "updatedAt" = ${result.now}
      WHERE "userId" = ${userId}`);
    const counts = await prisma.$transaction(statements);
    return { briefWritten: result.brief ? counts[0] > 0 : false };
  },

  async release(userId, nextBeatAt, now) {
    await prisma.$executeRaw`
      UPDATE "HeartbeatState" SET "nextBeatAt" = ${nextBeatAt}, "claimedUntil" = NULL, "updatedAt" = ${now} WHERE "userId" = ${userId}`;
  },

  async recordRun(run, now) {
    await prisma.$executeRaw`
      INSERT INTO "HeartbeatRun" ("id", "userId", "trigger", "outcome", "staleness", "modelCalled", "posts", "activities", "dropped", "pushed", "durationMs", "createdAt")
      VALUES (${randomUUID()}, ${run.userId}, ${run.trigger}, ${run.outcome}, ${run.staleness ?? null}, ${run.modelCalled}, ${run.posts}, ${run.activities}, ${run.dropped}, ${run.pushed}, ${run.durationMs}, ${now})`;
  },
};
