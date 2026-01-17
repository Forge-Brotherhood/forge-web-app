import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  '/api/invites/(.*)',  // Allow unauthenticated invite API lookups
  '/join/(.*)',         // Allow unauthenticated invite page access
  '/.well-known/(.*)',  // Apple App Site Association and other well-known files
  // Public Bible content routes (cacheable by Vercel edge)
  '/api/bible/books',
  '/api/bible/chapters',
  '/api/bible/chapter/(.*)',
  // Reading plan template day (for onboarding)
  '/api/reading-plans/templates/(.*)/days/(.*)',
  // Internal API routes (protected by API key, not Clerk)
  '/api/internal/(.*)',
  // Jobs/cron API routes (protected by API key, not Clerk)
  '/api/jobs/(.*)',
  '/api/cron/(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  // Allow internal admin tooling to hit /api/chat with impersonation using INTERNAL_API_KEY,
  // without being redirected to Clerk sign-in by middleware.
  const isChatRoute = req.nextUrl.pathname === "/api/chat" || req.nextUrl.pathname === "/api/bible-chat";
  if (isChatRoute) {
    const internalKey = req.headers.get("x-internal-api-key");
    const expectedKey = process.env.INTERNAL_API_KEY;
    const impersonateUserId = req.headers.get("x-impersonate-user-id");

    if (
      expectedKey &&
      internalKey === expectedKey &&
      typeof impersonateUserId === "string" &&
      impersonateUserId.trim().length > 0
    ) {
      return NextResponse.next();
    }
  }

  if (!isPublicRoute(req)) {
    const { userId } = await auth();

    if (!userId) {
      const signInUrl = new URL('/sign-in', req.url);
      return NextResponse.redirect(signInUrl);
    }
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
