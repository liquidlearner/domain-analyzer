export type JobStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface ProgressState {
  status: JobStatus
  progress: number
  message: string
  etaSeconds?: number
  startTime?: number
}

class JobProgressService {
  private progressMap = new Map<string, ProgressState>()

  updateProgress(
    jobId: string,
    update: Partial<ProgressState> & { status?: JobStatus; message: string }
  ): void {
    const current = this.progressMap.get(jobId) || {
      status: 'pending' as const,
      progress: 0,
      message: '',
      startTime: Date.now(),
    }

    const updated: ProgressState = {
      ...current,
      ...update,
      startTime: current.startTime,
    }

    this.progressMap.set(jobId, updated)
  }

  getProgress(jobId: string): ProgressState | undefined {
    return this.progressMap.get(jobId)
  }

  clearProgress(jobId: string): void {
    this.progressMap.delete(jobId)
  }

  getAllProgress(): Record<string, ProgressState> {
    const result: Record<string, ProgressState> = {}
    for (const [jobId, state] of this.progressMap.entries()) {
      result[jobId] = state
    }
    return result
  }
}

// Use globalThis to survive Next.js hot module reloading in dev mode
// (same pattern as Prisma client singleton)
const globalForJobProgress = globalThis as unknown as {
  jobProgress: JobProgressService
}

export const jobProgress =
  globalForJobProgress.jobProgress ?? new JobProgressService()

if (process.env.NODE_ENV !== 'production') {
  globalForJobProgress.jobProgress = jobProgress
}
