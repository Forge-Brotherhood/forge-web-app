import { z } from "zod";
import { prisma } from "@/lib/prisma";

/**
 * Storage for private records that are encrypted on the user's device. The key never reaches
 * the server, so nothing here can read a record: it only keeps and returns ciphertext.
 */

const collectionSchema = z.string().regex(/^[a-z_]{1,40}$/);
const idSchema = z.string().min(1).max(128);
const indexTokenSchema = z.string().min(1).max(64);

export const keyCheckSchema = z.string().regex(/^[0-9a-f]{32}$/);

export const listRecordsSchema = z.object({
  collection: collectionSchema,
  id: idSchema.optional(),
  indexToken: indexTokenSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

export const putRecordsSchema = z.object({
  records: z
    .array(
      z.object({
        collection: collectionSchema,
        id: idSchema,
        ciphertext: z.string().min(1).max(2_000_000),
        indexToken: indexTokenSchema.nullish(),
      })
    )
    .min(1)
    .max(100),
});

export const deleteRecordsSchema = z.object({
  collection: collectionSchema,
  ids: z.array(idSchema).min(1).max(500).optional(),
});

export async function getKeyCheck(userId: string): Promise<string | null> {
  const row = await prisma.vaultKey.findUnique({ where: { userId }, select: { keyCheck: true } });
  return row?.keyCheck ?? null;
}

/**
 * Registers the account's key check. An account has one key: registering a different one is
 * refused (records under the old key would become unreadable), and returns the one on file.
 */
export async function registerKeyCheck(
  userId: string,
  keyCheck: string
): Promise<{ registered: boolean; keyCheck: string }> {
  const row = await prisma.vaultKey.upsert({
    where: { userId },
    create: { userId, keyCheck },
    update: {},
    select: { keyCheck: true },
  });
  return { registered: row.keyCheck === keyCheck, keyCheck: row.keyCheck };
}

/** Starting over: removes every record and the key registration. */
export async function wipeVault(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.vaultRecord.deleteMany({ where: { userId } }),
    prisma.vaultKey.deleteMany({ where: { userId } }),
  ]);
}

export async function listRecords(userId: string, query: z.infer<typeof listRecordsSchema>) {
  const rows = await prisma.vaultRecord.findMany({
    where: {
      userId,
      collection: query.collection,
      ...(query.id ? { id: query.id } : {}),
      ...(query.indexToken ? { indexToken: query.indexToken } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: query.limit,
    skip: query.offset,
    select: { id: true, ciphertext: true, indexToken: true, updatedAt: true },
  });
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export async function putRecords(userId: string, input: z.infer<typeof putRecordsSchema>): Promise<void> {
  await prisma.$transaction(
    input.records.map((r) => {
      const data = { ciphertext: r.ciphertext, indexToken: r.indexToken ?? null };
      return prisma.vaultRecord.upsert({
        where: { userId_collection_id: { userId, collection: r.collection, id: r.id } },
        create: { userId, collection: r.collection, id: r.id, ...data },
        update: data,
      });
    })
  );
}

/** Without `ids`, the whole collection is deleted. */
export async function deleteRecords(userId: string, input: z.infer<typeof deleteRecordsSchema>): Promise<number> {
  const result = await prisma.vaultRecord.deleteMany({
    where: { userId, collection: input.collection, ...(input.ids ? { id: { in: input.ids } } : {}) },
  });
  return result.count;
}
