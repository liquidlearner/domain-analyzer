import { NextRequest, NextResponse } from 'next/server'
import { jobProgress } from '@/server/services/job-progress'

const encoder = new TextEncoder()

function createSSEEvent(data: unknown): Uint8Array {
  const jsonString = JSON.stringify(data)
  return encoder.encode(`data: ${jsonString}\n\n`)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params

  // Validate jobId
  if (!jobId || typeof jobId !== 'string') {
    return NextResponse.json(
      { error: 'Invalid jobId' },
      { status: 400 }
    )
  }

  // Create a streaming response with SSE
  const stream = new ReadableStream({
    async start(controller) {
      try {
        let lastSentState: unknown = null
        const pollInterval = setInterval(() => {
          const state = jobProgress.getProgress(jobId)

          if (!state) {
            controller.enqueue(
              createSSEEvent({
                status: 'not_found',
                message: 'Job not found',
              })
            )
            clearInterval(pollInterval)
            controller.close()
            return
          }

          // Only send if state changed
          if (JSON.stringify(state) !== JSON.stringify(lastSentState)) {
            controller.enqueue(createSSEEvent(state))
            lastSentState = state
          }

          // Close stream when job completes or fails
          if (state.status === 'completed' || state.status === 'failed') {
            clearInterval(pollInterval)
            controller.close()
          }
        }, 1000) // Poll every 1 second

        // Send initial state immediately
        const initialState = jobProgress.getProgress(jobId)
        if (initialState) {
          controller.enqueue(createSSEEvent(initialState))
          lastSentState = initialState

          // Auto-close if already finished
          if (
            initialState.status === 'completed' ||
            initialState.status === 'failed'
          ) {
            clearInterval(
              setTimeout(() => {
                clearInterval(pollInterval)
              }, 100)
            )
          }
        } else {
          // No job data yet
          controller.enqueue(
            createSSEEvent({
              status: 'pending',
              progress: 0,
              message: 'Job pending',
            })
          )
        }

        // Cleanup on abort
        request.signal.addEventListener('abort', () => {
          clearInterval(pollInterval)
          try {
            controller.close()
          } catch {
            // Already closed
          }
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error'
        controller.enqueue(
          createSSEEvent({
            status: 'failed',
            progress: 0,
            message,
          })
        )
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Content-Encoding': 'none',
    },
  })
}
