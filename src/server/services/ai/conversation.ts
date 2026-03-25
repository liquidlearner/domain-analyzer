import { prisma } from '@/server/db/client'
import { compressJson, decompressJson } from '@/lib/compression'
import { estimateTokens } from './advisor'

const MAX_CONVERSATION_TOKENS = 100_000
const HISTORY_TOKEN_BUDGET = 20_000

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  action?: string
  tokenCount: number
}

/**
 * Create a new conversation for an evaluation.
 */
export async function createConversation(
  evaluationId: string,
  createdById: string,
  firstMessage: string,
  action?: string
): Promise<{ id: string; messages: ConversationMessage[] }> {
  const message: ConversationMessage = {
    role: 'user',
    content: firstMessage,
    timestamp: new Date().toISOString(),
    action,
    tokenCount: estimateTokens(firstMessage),
  }

  const title = generateTitle(firstMessage, action)

  const conversation = await prisma.aiConversation.create({
    data: {
      evaluationId,
      createdById,
      title,
      messagesJson: compressJson([message]),
      tokenCount: message.tokenCount,
    },
  })

  return { id: conversation.id, messages: [message] }
}

/**
 * Get all messages for a conversation.
 */
export async function getMessages(conversationId: string): Promise<ConversationMessage[]> {
  const conversation = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
  })
  if (!conversation) return []
  return decompressJson<ConversationMessage[]>(conversation.messagesJson)
}

/**
 * Add a message to a conversation and return the updated history.
 * Applies sliding window if token budget is exceeded.
 */
export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  action?: string
): Promise<ConversationMessage[]> {
  const conversation = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
  })
  if (!conversation) throw new Error('Conversation not found')

  const messages = decompressJson<ConversationMessage[]>(conversation.messagesJson)
  const newMessage: ConversationMessage = {
    role,
    content,
    timestamp: new Date().toISOString(),
    action,
    tokenCount: estimateTokens(content),
  }

  messages.push(newMessage)
  const totalTokens = messages.reduce((sum, m) => sum + m.tokenCount, 0)

  await prisma.aiConversation.update({
    where: { id: conversationId },
    data: {
      messagesJson: compressJson(messages),
      tokenCount: totalTokens,
    },
  })

  return messages
}

/**
 * Get conversation messages trimmed to fit within the history token budget.
 * Always keeps the most recent messages; drops oldest pairs first.
 */
export function getWindowedMessages(messages: ConversationMessage[]): ConversationMessage[] {
  let totalTokens = messages.reduce((sum, m) => sum + m.tokenCount, 0)

  if (totalTokens <= HISTORY_TOKEN_BUDGET) {
    return messages
  }

  // Drop oldest message pairs until within budget
  const windowed = [...messages]
  while (totalTokens > HISTORY_TOKEN_BUDGET && windowed.length > 2) {
    const removed = windowed.shift()!
    totalTokens -= removed.tokenCount
  }

  return windowed
}

/**
 * Check if the conversation has exceeded its token budget.
 */
export async function isOverBudget(conversationId: string): Promise<boolean> {
  const conversation = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
    select: { tokenCount: true },
  })
  return (conversation?.tokenCount ?? 0) >= MAX_CONVERSATION_TOKENS
}

/**
 * List conversations for an evaluation.
 */
export async function listConversations(evaluationId: string) {
  return prisma.aiConversation.findMany({
    where: { evaluationId },
    select: {
      id: true,
      title: true,
      tokenCount: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  })
}

/**
 * Delete a conversation.
 */
export async function deleteConversation(conversationId: string) {
  return prisma.aiConversation.delete({
    where: { id: conversationId },
  })
}

/**
 * Auto-generate a conversation title from the first message.
 */
function generateTitle(message: string, action?: string): string {
  if (action) {
    const actionTitles: Record<string, string> = {
      executive_summary: 'Executive Summary',
      team_breakdown: 'Team Breakdown',
      risk_brief: 'Risk Brief',
      migration_runbook: 'Migration Runbook',
      stakeholder_email: 'Stakeholder Email',
    }
    return actionTitles[action] || action
  }

  // Truncate first message to ~50 chars for title
  const cleaned = message.replace(/\n/g, ' ').trim()
  if (cleaned.length <= 50) return cleaned
  return cleaned.slice(0, 47) + '...'
}
