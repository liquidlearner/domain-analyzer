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

  if (!jobId || typeof jobId !== 'string') {
    return NextResponse.json(
      { error: 'Invalid jobId' },
      { status: 400 }
    )
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let notFoundCount = 0
        const maxNotFound = 30 // Wait up to 30 seconds for job to appear

        const pollInterval = setInterval(() => {
          const state = jobProgress.getProgress(jobId)

          if (!state) {
            notFoundCount++
            // Send pending status while waiting for job to start
            controller.enqueue(
              createSSEEvent({
                status: 'pending',
                progress: 0,
                message: 'Waiting for analysis to start...',
              })
            )

            // Close after timeout
            if (notFoundCount >= maxNotFound) {
              controller.enqueue(
                createSSEEvent({
                  status: 'not_found',
                  progress: 0,
                  message: 'Job not found after timeout',
                })
              )
              clearInterval(pollInterval)
              controller.close()
            }
            return
          }

          // Reset counter once job appears
          notFoundCount = 0

          controller.enqueue(createSSEEvent(state))

          // Close stream when job completes or fails
          if (state.status === 'completed' || state.status === 'failed') {
            clearInterval(pollInterval)
            // Small delay before closing to ensure client receives final message
            setTimeout(() => {
              try {
                controller.close()
              } catch {
                // Already closed
              }
            }, 500)
          }
        }, 1000)

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
