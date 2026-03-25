import { z } from 'zod'
import { router, protectedProcedure, seProcedure } from '../trpc'
import { isAiAvailable } from '@/server/services/ai/advisor'
import {
  listConversations,
  getMessages,
  deleteConversation,
} from '@/server/services/ai/conversation'

export const aiRouter = router({
  /**
   * Check if AI advisor is available (API key configured).
   */
  isAvailable: protectedProcedure.query(() => {
    return { available: isAiAvailable() }
  }),

  /**
   * List conversations for an evaluation.
   */
  listConversations: protectedProcedure
    .input(z.object({ evaluationId: z.string() }))
    .query(async ({ input }) => {
      return listConversations(input.evaluationId)
    }),

  /**
   * Load a conversation's full message history.
   */
  getConversation: protectedProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(async ({ input }) => {
      return getMessages(input.conversationId)
    }),

  /**
   * Delete a conversation.
   */
  deleteConversation: seProcedure
    .input(z.object({ conversationId: z.string() }))
    .mutation(async ({ input }) => {
      await deleteConversation(input.conversationId)
      return { deleted: true }
    }),
})
