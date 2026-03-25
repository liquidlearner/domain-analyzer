import { auth } from '@/lib/auth'
import { prisma } from '@/server/db/client'
import { decompressJson } from '@/lib/compression'
import { isAiAvailable, streamAdvisorResponse } from '@/server/services/ai/advisor'
import { buildAdvisorContext, type AnalysisData, type EvaluationInfo } from '@/server/services/ai/context-builder'
import { buildSystemPrompt, QUICK_ACTION_PROMPTS, type QuickActionType } from '@/server/services/ai/prompts'
import {
  createConversation,
  addMessage,
  getMessages,
  getWindowedMessages,
  isOverBudget,
} from '@/server/services/ai/conversation'
import { logAudit } from '@/server/services/audit'

// Simple in-memory rate limiting
const rateLimits = new Map<string, { count: number; resetAt: number }>()
const evalRateLimits = new Map<string, number>()

const PER_USER_LIMIT = parseInt(process.env.AI_RATE_LIMIT_PER_HOUR || '20', 10)
const PER_EVAL_LIMIT = parseInt(process.env.AI_RATE_LIMIT_PER_EVAL || '50', 10)

function checkUserRateLimit(userId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  const entry = rateLimits.get(userId)
  if (!entry || now > entry.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + 3600_000 })
    return { allowed: true }
  }
  if (entry.count >= PER_USER_LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
  }
  entry.count++
  return { allowed: true }
}

function checkEvalRateLimit(evaluationId: string): boolean {
  const count = evalRateLimits.get(evaluationId) || 0
  if (count >= PER_EVAL_LIMIT) return false
  evalRateLimits.set(evaluationId, count + 1)
  return true
}

export async function POST(request: Request) {
  // Auth check
  const session = await auth()
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Feature availability check
  if (!isAiAvailable()) {
    return new Response(JSON.stringify({ error: 'AI Advisor is not configured' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Parse request body
  let body: { evaluationId: string; conversationId?: string; message: string; action?: string }
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { evaluationId, conversationId, message, action } = body

  if (!evaluationId || !message || message.length > 2000) {
    return new Response(JSON.stringify({ error: 'Invalid input: evaluationId and message (max 2000 chars) required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Rate limiting
  const userLimit = checkUserRateLimit(session.user.id)
  if (!userLimit.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded', retryAfter: userLimit.retryAfter }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!checkEvalRateLimit(evaluationId)) {
    return new Response(JSON.stringify({ error: 'Evaluation AI request limit exceeded' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Check conversation token budget
  if (conversationId) {
    const overBudget = await isOverBudget(conversationId)
    if (overBudget) {
      return new Response(JSON.stringify({ error: 'Conversation token budget exceeded. Please start a new conversation.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  // Load evaluation with analysis data
  const evaluation = await prisma.evaluation.findUnique({
    where: { id: evaluationId },
    include: {
      domain: true,
      configSnapshot: {
        include: {
          resources: {
            select: {
              id: true,
              pdType: true,
              pdId: true,
              name: true,
              teamIds: true,
            },
          },
        },
      },
      migrationMappings: {
        select: {
          pdResourceId: true,
          ioResourceType: true,
          conversionStatus: true,
          effortEstimate: true,
        },
      },
    },
  })

  if (!evaluation || evaluation.status !== 'COMPLETED') {
    return new Response(JSON.stringify({ error: 'Evaluation not found or not completed' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Load analysis data (same as getAnalysisData tRPC endpoint)
  const analysis = await prisma.incidentAnalysis.findFirst({
    where: { evaluationId },
    orderBy: { periodStart: 'desc' },
  })

  if (!analysis) {
    return new Response(JSON.stringify({ error: 'No analysis data found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let sourcesData: any = {}
  let patternsData: any = {}
  try { sourcesData = decompressJson(analysis.sourcesJson) } catch { /* ignore */ }
  try { patternsData = decompressJson(analysis.patternsJson) } catch { /* ignore */ }

  const analysisData: AnalysisData = {
    volume: sourcesData.volume || null,
    sources: sourcesData.sources || null,
    risk: sourcesData.risk || null,
    shadowStack: sourcesData.shadowStack || null,
    projectPlan: sourcesData.projectPlan || null,
    noise: patternsData,
    scopedCounts: sourcesData.scopedCounts || null,
    meta: {
      incidentCount: analysis.incidentCount,
      alertCount: analysis.alertCount,
      noiseRatio: analysis.noiseRatio,
      mttrP50: analysis.mttrP50,
      mttrP95: analysis.mttrP95,
      periodStart: analysis.periodStart,
      periodEnd: analysis.periodEnd,
      shadowSignals: analysis.shadowSignals,
    },
  }

  // Build context and system prompt
  const evalInfo: EvaluationInfo = {
    id: evaluation.id,
    domain: evaluation.domain,
    configSnapshot: evaluation.configSnapshot,
    migrationMappings: evaluation.migrationMappings,
    scopeType: evaluation.scopeType,
    timeRangeDays: evaluation.timeRangeDays,
    completedAt: evaluation.completedAt,
  }

  const advisorContext = buildAdvisorContext(evalInfo, analysisData)
  const systemPrompt = buildSystemPrompt(advisorContext.systemContext)

  // Resolve the actual user message (quick action or free-form)
  const userMessage = action && QUICK_ACTION_PROMPTS[action as QuickActionType]
    ? QUICK_ACTION_PROMPTS[action as QuickActionType]
    : message

  // Create or load conversation
  let activeConversationId = conversationId
  let history: Awaited<ReturnType<typeof getMessages>>

  if (conversationId) {
    // Add user message to existing conversation
    history = await addMessage(conversationId, 'user', userMessage, action)
  } else {
    // Create new conversation
    const conv = await createConversation(evaluationId, session.user.id, userMessage, action)
    activeConversationId = conv.id
    history = conv.messages
  }

  // Get windowed messages for the API call
  const windowedHistory = getWindowedMessages(history)
  const apiMessages = windowedHistory.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  // Audit log
  logAudit({
    userId: session.user.id,
    action: 'ai.chat',
    entityType: 'Evaluation',
    entityId: evaluationId,
    metadata: {
      conversationId: activeConversationId,
      action: action || 'freeform',
      messageLength: userMessage.length,
    },
  }).catch(() => {})

  // Stream response via SSE
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send conversation ID as first event
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'conversation_id', id: activeConversationId })}\n\n`)
        )

        let fullResponse = ''

        for await (const chunk of streamAdvisorResponse(systemPrompt, apiMessages)) {
          fullResponse += chunk
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'token', text: chunk })}\n\n`)
          )
        }

        // Save assistant response to conversation
        if (activeConversationId) {
          await addMessage(activeConversationId, 'assistant', fullResponse)
        }

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
        )
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', message: errorMessage })}\n\n`)
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
