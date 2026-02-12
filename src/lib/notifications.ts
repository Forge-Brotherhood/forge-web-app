import { prisma } from '@/lib/prisma';
import { sendPushNotification, cleanupInvalidTokens, PushPayload } from '@/lib/fcm';

export type NotificationType =
  | 'new_prayer_request'
  | 'prayer_update'
  | 'testimony'
  | 'encouragement';

export interface NotificationContext {
  threadId?: string;
  threadTitle?: string;
  authorName?: string;
  authorProfileImageUrl?: string; // Avatar to display in rich notification
  excludeUserId?: string; // Don't notify the author of their own action
  entryId?: string; // Specific post/entry to scroll to
}

/**
 * Fire-and-forget wrapper for encouragement notifications.
 * Only notifies the thread author.
 */
export function sendEncouragementNotificationAsync(
  threadAuthorId: string,
  context: NotificationContext
): void {
  sendEncouragementNotification(threadAuthorId, context).catch(err => {
    console.error('Failed to send encouragement notification:', err);
  });
}

/**
 * Send encouragement notification to thread author only.
 */
async function sendEncouragementNotification(
  threadAuthorId: string,
  context: NotificationContext
): Promise<void> {
  // Get thread author's tokens
  const author = await prisma.user.findUnique({
    where: { id: threadAuthorId },
    select: {
      pushTokens: {
        where: { isActive: true },
        select: { token: true },
      },
    },
  });

  if (!author) return;

  const tokens = author.pushTokens.map(t => t.token);
  if (tokens.length === 0) return;

  const payload = buildNotificationPayload('encouragement', context);
  const { failedTokens } = await sendPushNotification(tokens, payload);

  if (failedTokens.length > 0) {
    await cleanupInvalidTokens(failedTokens);
  }
}

/**
 * Fire-and-forget wrapper for user notifications.
 * Sends notification to a specific user.
 */
export function sendUserNotificationAsync(
  userId: string,
  type: NotificationType,
  context: NotificationContext
): void {
  sendUserNotification(userId, type, context).catch(err => {
    console.error('Failed to send user notification:', err);
  });
}

/**
 * Send notification to a specific user.
 */
async function sendUserNotification(
  userId: string,
  type: NotificationType,
  context: NotificationContext
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      pushTokens: {
        where: { isActive: true },
        select: { token: true },
      },
    },
  });

  if (!user) return;

  const tokens = user.pushTokens.map(t => t.token);
  if (tokens.length === 0) return;

  const payload = buildNotificationPayload(type, context);
  const { failedTokens } = await sendPushNotification(tokens, payload);

  if (failedTokens.length > 0) {
    await cleanupInvalidTokens(failedTokens);
  }
}

/**
 * Build the notification payload based on type.
 */
function buildNotificationPayload(
  type: NotificationType,
  context: NotificationContext
): PushPayload {
  const { threadTitle, authorName, authorProfileImageUrl } = context;
  const truncatedTitle = threadTitle
    ? threadTitle.length > 50
      ? threadTitle.substring(0, 47) + '...'
      : threadTitle
    : '';

  const imageUrl = authorProfileImageUrl;

  switch (type) {
    case 'new_prayer_request':
      return {
        title: 'New Prayer Request',
        body: `${authorName || 'Someone'} shared a prayer request${truncatedTitle ? `: "${truncatedTitle}"` : ''}`,
        data: {
          type: 'thread',
          threadId: context.threadId || '',
          entryId: context.entryId || '',
        },
        imageUrl,
      };

    case 'prayer_update':
      return {
        title: 'Prayer Update',
        body: `${authorName || 'Someone'} posted an update${truncatedTitle ? `: "${truncatedTitle}"` : ''}`,
        data: {
          type: 'thread',
          threadId: context.threadId || '',
          entryId: context.entryId || '',
        },
        imageUrl,
      };

    case 'testimony':
      return {
        title: 'Testimony Shared',
        body: `${authorName || 'Someone'} shared a testimony${truncatedTitle ? `: "${truncatedTitle}"` : ''}`,
        data: {
          type: 'thread',
          threadId: context.threadId || '',
          entryId: context.entryId || '',
        },
        imageUrl,
      };

    case 'encouragement':
      return {
        title: 'Encouragement Received',
        body: `${authorName || 'Someone'} sent you an encouragement`,
        data: {
          type: 'thread',
          threadId: context.threadId || '',
          entryId: context.entryId || '',
        },
        imageUrl,
      };

    default:
      return {
        title: 'Forge',
        body: 'You have a new notification',
        data: {},
      };
  }
}
