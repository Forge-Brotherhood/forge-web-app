import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getKeyCheck, keyCheckSchema, registerKeyCheck } from "@/lib/vault/vaultStore";

const putSchema = z.object({ keyCheck: keyCheckSchema });

// GET /api/vault/key
// Tells a device whether the account already has a key, and lets it check it holds the right one.
export async function GET() {
  const authResult = await getAuth();
  if (!authResult) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({ keyCheck: await getKeyCheck(authResult.userId) });
}

// PUT /api/vault/key
export async function PUT(request: NextRequest) {
  const authResult = await getAuth();
  if (!authResult) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request data" }, { status: 400 });

  const result = await registerKeyCheck(authResult.userId, parsed.data.keyCheck);
  if (!result.registered) {
    return NextResponse.json({ error: "This account already has a different key" }, { status: 409 });
  }
  return NextResponse.json({ keyCheck: result.keyCheck });
}
