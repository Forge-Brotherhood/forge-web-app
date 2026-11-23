import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { wipeVault } from "@/lib/vault/vaultStore";

// DELETE /api/vault
// Starting over (for a user who lost their key): removes every record and the key registration.
export async function DELETE() {
  const authResult = await getAuth();
  if (!authResult) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await wipeVault(authResult.userId);
  return NextResponse.json({ success: true });
}
