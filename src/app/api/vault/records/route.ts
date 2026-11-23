import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import {
  deleteRecords,
  deleteRecordsSchema,
  listRecords,
  listRecordsSchema,
  putRecords,
  putRecordsSchema,
} from "@/lib/vault/vaultStore";

const invalid = () => NextResponse.json({ error: "Invalid request data" }, { status: 400 });
const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// GET /api/vault/records?collection=&id=&indexToken=&limit=&offset=
export async function GET(request: NextRequest) {
  const authResult = await getAuth();
  if (!authResult) return unauthorized();

  const parsed = listRecordsSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return invalid();

  return NextResponse.json({ records: await listRecords(authResult.userId, parsed.data) });
}

// PUT /api/vault/records
export async function PUT(request: NextRequest) {
  const authResult = await getAuth();
  if (!authResult) return unauthorized();

  const parsed = putRecordsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid();

  await putRecords(authResult.userId, parsed.data);
  return NextResponse.json({ success: true });
}

// DELETE /api/vault/records
export async function DELETE(request: NextRequest) {
  const authResult = await getAuth();
  if (!authResult) return unauthorized();

  const parsed = deleteRecordsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid();

  return NextResponse.json({ success: true, deleted: await deleteRecords(authResult.userId, parsed.data) });
}
