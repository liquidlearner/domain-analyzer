import { serve } from 'inngest/next'
import { inngest } from '@/server/jobs/inngest'
import { configExport } from '@/server/jobs/config-export'
import { conversionAnalysis } from '@/server/jobs/conversion-analysis'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [configExport, conversionAnalysis],
})
