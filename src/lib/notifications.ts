import { prisma } from '@/lib/prisma';
import { sendPushNotification, cleanupInvalidTokens, PushPayload } from '@/lib/fcm';

export type NotificationType =
  | 'new_prayer_request'
  | 'prayer_update'
  | 'testimony'
  | 'encouragement'
  | 'group_welcome';

export interface NotificationContext {
  groupId: string;
  groupName: string;
  threadId?: string;
  threadTitle?: string;
  authorName?: string;
  authorProfileImageUrl?: string; // Avatar to display in rich notification
  excludeUserId?: string; // Don't notify the author of their own action
  entryId?: string; // Specific post/entry to scroll to
}

/**
 * Fire-and-forget wrapper for async group notifications.
 * Use this in API routes - it won't block the response.
 */
export function sendGroupNotificationAsync(
  type: NotificationType,
  context: NotificationContext
): void {
  sendGroupNotification(type, context).catch(err => {
    console.error('Failed to send group notification:', err);
  });
}

/**
 * Send notification to all group members with push enabled.
 */
async function sendGroupNotification(
  type: NotificationType,
  context: NotificationContext
): Promise<void> {
  // 1. Get all active group members (excluding the author if specified)
  const recipients = await prisma.groupMember.findMany({
    where: {
      groupId: context.groupId,
      status: 'active',
      userId: context.excludeUserId ? { not: context.excludeUserId } : undefined,
    },
    select: {
      userId: true,
      user: {
        select: {
          pushTokens: {
            where: { isActive: true },
            select: { token: true },
          },
          groupNotificationPrefs: {
            where: { groupId: context.groupId },
            select: { pushEnabled: true },
          },
        },
      },
    },
  });

  // 2. Filter to users with push enabled (default true if no preference exists)
  const tokens: string[] = [];
  for (const member of recipients) {
    const pref = member.user.groupNotificationPrefs[0];
    const pushEnabled = pref?.pushEnabled ?? true; // Default ON

    if (pushEnabled) {
      tokens.push(...member.user.pushTokens.map(t => t.token));
    }
  }

  if (tokens.length === 0) return;

  // 3. Build notification payload
  const payload = buildNotificationPayload(type, context);

  // 4. Send via FCM
  const { failedTokens } = await sendPushNotification(tokens, payload);

  // 5. Cleanup invalid tokens
  if (failedTokens.length > 0) {
    await cleanupInvalidTokens(failedTokens);
  }
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
  // Get thread author's tokens and preference for this group
  const author = await prisma.user.findUnique({
    where: { id: threadAuthorId },
    select: {
      pushTokens: {
        where: { isActive: true },
        select: { token: true },
      },
      groupNotificationPrefs: {
        where: { groupId: context.groupId },
        select: { pushEnabled: true },
      },
    },
  });

  if (!author) return;

  // Check if push is enabled (default true)
  const pref = author.groupNotificationPrefs[0];
  const pushEnabled = pref?.pushEnabled ?? true;
  if (!pushEnabled) return;

  const tokens = author.pushTokens.map(t => t.token);
  if (tokens.length === 0) return;

  const payload = buildNotificationPayload('encouragement', context);
  const { failedTokens } = await sendPushNotification(tokens, payload);

  if (failedTokens.length > 0) {
    await cleanupInvalidTokens(failedTokens);
  }
}

/**
 * Fire-and-forget wrapper for welcome notifications.
 * Sends to the user who just joined.
 */
export function sendWelcomeNotificationAsync(
  userId: string,
  context: NotificationContext
): void {
  sendWelcomeNotification(userId, context).catch(err => {
    console.error('Failed to send welcome notification:', err);
  });
}

/**
 * Send welcome notification to a user who just joined a group.
 */
async function sendWelcomeNotification(
  userId: string,
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

  const payload = buildNotificationPayload('group_welcome', context);
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
  const { groupName, threadTitle, authorName, authorProfileImageUrl } = context;
  const truncatedTitle = threadTitle
    ? threadTitle.length > 50
      ? threadTitle.substring(0, 47) + '...'
      : threadTitle
    : '';

  // Include imageUrl for notifications with an actor (not for system notifications)
  const imageUrl = type !== 'group_welcome' ? authorProfileImageUrl : undefined;

  switch (type) {
    case 'new_prayer_request':
      return {
        title: groupName,
        body: `${authorName || 'Someone'} shared a prayer request${truncatedTitle ? `: "${truncatedTitle}"` : ''}`,
        data: {
          type: 'thread',
          threadId: context.threadId || '',
          groupId: context.groupId,
          entryId: context.entryId || '',
        },
        imageUrl,
      };

    case 'prayer_update':
      return {
        title: groupName,
        body: `${authorName || 'Someone'} posted an update${truncatedTitle ? `: "${truncatedTitle}"` : ''}`,
        data: {
          type: 'thread',
          threadId: context.threadId || '',
          groupId: context.groupId,
          entryId: context.entryId || '',
        },
        imageUrl,
      };

    case 'testimony':
      return {
        title: groupName,
        body: `${authorName || 'Someone'} shared a testimony${truncatedTitle ? `: "${truncatedTitle}"` : ''}`,
        data: {
          type: 'thread',
          threadId: context.threadId || '',
          groupId: context.groupId,
          entryId: context.entryId || '',
        },
        imageUrl,
      };

    case 'encouragement':
      return {
        title: groupName,
        body: `${authorName || 'Someone'} sent you an encouragement`,
        data: {
          type: 'thread',
          threadId: context.threadId || '',
          groupId: context.groupId,
          entryId: context.entryId || '',
        },
        imageUrl,
      };

    case 'group_welcome':
      return {
        title: 'Welcome to Forge!',
        body: `You've joined ${groupName}`,
        data: {
          type: 'group',
          groupId: context.groupId,
        },
      };

    default:
      return {
        title: 'Forge',
        body: 'You have a new notification',
        data: {},
      };
  }
}
