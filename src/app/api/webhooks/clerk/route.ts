// Next.js App Router — Node runtime
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { headers } from "next/headers";
import { Webhook } from "svix";
import { prisma } from "@/lib/prisma";
import { BanState } from "@prisma/client";

// Clerk webhook event types
interface ClerkUserEvent {
  id: string;
  email_addresses?: Array<{
    id: string;
    email_address: string;
  }>;
  primary_email_address_id?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  image_url?: string;
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserEvent;
  object: string;
  id: string;
}

// Keep this in env (different secret for dev vs prod)
const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET!;

export async function POST(req: Request) {
  if (!WEBHOOK_SECRET) {
    return new Response("Missing CLERK_WEBHOOK_SECRET", { status: 500 });
  }

  const body = await req.text();                 // IMPORTANT: raw body for signature
  const hdrs = await headers();                  // Grab Svix headers from Clerk
  const svixId = hdrs.get("svix-id")!;
  const svixTimestamp = hdrs.get("svix-timestamp")!;
  const svixSignature = hdrs.get("svix-signature")!;

  let evt: ClerkWebhookEvent;
  try {
    const wh = new Webhook(WEBHOOK_SECRET);
    evt = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch (e) {
    return new Response("Invalid signature", { status: 400 });
  }

  // ---- Handle events you care about ----
  const type = evt.type;

  // idempotency tip: use evt.id (Svix event id) if you want to dedupe
  // await prisma.eventReceipt.create({ data: { id: evt.id } }).catch(() => {/* already processed */});

  if (type === "user.created" || type === "user.updated") {
    const u = evt.data;
    const primaryEmail = u.email_addresses?.find((e) => e.id === u.primary_email_address_id);
    const email = primaryEmail?.email_address;

    if (!email) {
      console.error("No email found for user", u.id);
      return new Response("No email found", { status: 400 });
    }

    try {
      await prisma.user.upsert({
        where: { clerkId: u.id },
        update: {
          email,
          firstName: u.first_name ?? null,
          lastName: u.last_name ?? null,
          displayName: u.first_name ?? u.username ?? null,
          handle: u.username ?? null,
          profileImageUrl: u.image_url ?? null,
        },
        create: {
          clerkId: u.id,
          email,
          firstName: u.first_name ?? null,
          lastName: u.last_name ?? null,
          displayName: u.first_name ?? u.username ?? null,
          handle: u.username ?? null,
          profileImageUrl: u.image_url ?? null,
          role: "user",
          banState: BanState.active,
        },
      });
    } catch (error: any) {
      // Handle unique constraint errors - fail on collisions
      if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
        console.error(`Email ${email} already exists for another user. Failing for Clerk ID ${u.id}`);
        return new Response(`Email conflict: ${email} already exists`, { status: 409 });
      } else {
        throw error; // Re-throw other errors
      }
    }
  }

  if (type === "user.deleted") {
    await prisma.user.updateMany({
      where: { clerkId: evt.data.id },
      data: { banState: BanState.banned },
    });
  }

  // Optional: merge guest data when a session is created
  // if (type === "session.created") { ... }

  return new Response("ok", { status: 200 });
}
