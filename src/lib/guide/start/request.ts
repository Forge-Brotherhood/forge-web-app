import { z } from "zod";

export const guideStartRequestSchema = z.object({
  // Optional: allow client to pass a stable conversationId if desired later
  conversationId: z.string().min(1).max(128).optional(),
  enabledActions: z.array(z.string().min(1).max(64)).max(32).optional(),
});

export type GuideStartRequest = z.infer<typeof guideStartRequestSchema>;


