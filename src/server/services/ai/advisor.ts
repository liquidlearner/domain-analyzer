import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

/**
 * Check if the AI advisor feature is available (API key configured).
 */
export function isAiAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

/**
 * Get or create the Anthropic client instance.
 * Returns null if no API key is configured.
 */
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })
  }
  return _client
}

export interface AdvisorMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Stream a response from the AI advisor.
 * Yields text chunks as they arrive from the Anthropic API.
 */
export async function* streamAdvisorResponse(
  systemPrompt: string,
  messages: AdvisorMessage[]
): AsyncGenerator<string> {
  const client = getClient()
  if (!client) {
    yield 'AI Advisor is not available. Please configure the ANTHROPIC_API_KEY environment variable.'
    return
  }

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  })

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      yield event.delta.text
    }
  }
}

/**
 * Rough token count estimate from string length.
 * ~4 characters per token is a reasonable approximation for English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
