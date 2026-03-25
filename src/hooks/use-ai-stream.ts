"use client"

import { useState, useCallback, useRef } from 'react'

interface StreamMessage {
  type: 'conversation_id' | 'token' | 'done' | 'error'
  id?: string
  text?: string
  message?: string
}

interface UseAiStreamOptions {
  onConversationId?: (id: string) => void
  onComplete?: (fullText: string) => void
  onError?: (error: string) => void
}

export function useAiStream(options: UseAiStreamOptions = {}) {
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(async (params: {
    evaluationId: string
    conversationId?: string
    message: string
    action?: string
  }) => {
    // Abort any in-flight request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsStreaming(true)
    setStreamingText('')
    setError(null)

    let fullText = ''

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(errorBody.error || `Request failed with status ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE messages
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || '' // Keep incomplete last chunk

        for (const line of lines) {
          const dataMatch = line.match(/^data: (.+)$/m)
          if (!dataMatch) continue

          try {
            const msg: StreamMessage = JSON.parse(dataMatch[1])

            switch (msg.type) {
              case 'conversation_id':
                if (msg.id) options.onConversationId?.(msg.id)
                break
              case 'token':
                if (msg.text) {
                  fullText += msg.text
                  setStreamingText(fullText)
                }
                break
              case 'done':
                options.onComplete?.(fullText)
                break
              case 'error':
                setError(msg.message || 'An error occurred')
                options.onError?.(msg.message || 'An error occurred')
                break
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      const message = err instanceof Error ? err.message : 'An unexpected error occurred'
      setError(message)
      options.onError?.(message)
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [options])

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return {
    streamingText,
    isStreaming,
    error,
    sendMessage,
    abort,
  }
}
