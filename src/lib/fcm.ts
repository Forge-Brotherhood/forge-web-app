import admin from 'firebase-admin';
import { prisma } from '@/lib/prisma';

// Initialize Firebase Admin SDK (singleton pattern)
function getFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return admin.apps[0]!;
  }

  // Check for required environment variables
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    console.warn('Firebase credentials not configured. Push notifications disabled.');
    return null;
  }

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

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

/**
 * Send push notification to multiple device tokens
 */
export async function sendPushNotification(
  tokens: string[],
  payload: PushPayload
): Promise<PushResult> {
  if (tokens.length === 0) {
    return { successCount: 0, failedTokens: [] };
  }

  const app = getFirebaseAdmin();
  if (!app) {
    console.warn('Firebase not initialized. Skipping push notification.');
    return { successCount: 0, failedTokens: [] };
  }

  try {
    const message = {
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data || {},
      tokens,
      apns: {
        payload: {
          aps: {
            'mutable-content': 1,
            sound: 'default',
            badge: 1,
          },
        },
        ...(payload.imageUrl && {
          fcm_options: {
            image: payload.imageUrl,
          },
        }),
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    const failedTokens: string[] = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        // Log the error for debugging
        console.error(`FCM send failed for token ${tokens[idx]}:`, resp.error?.message);

        // Check if this is an unregistered token error
        const errorCode = resp.error?.code;
        if (
          errorCode === 'messaging/invalid-registration-token' ||
          errorCode === 'messaging/registration-token-not-registered'
        ) {
          failedTokens.push(tokens[idx]);
        }
      }
    });

    return {
      successCount: response.successCount,
      failedTokens,
    };
  } catch (error) {
    console.error('Failed to send push notification:', error);
    return { successCount: 0, failedTokens: [] };
  }
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
    console.error('Failed to cleanup invalid tokens:', error);
  }
}
