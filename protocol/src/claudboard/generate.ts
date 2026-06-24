import { z } from 'zod'

export const claudboardGenerateInputSchema = z.object({
  staleReportPolicy: z.enum(['warn-continue', 'warn-block']).default('warn-continue'),
  generateClaude: z.boolean().default(true),
  generateRules: z.boolean().default(true),
  generateSkills: z.boolean().default(true),
})

export type ClaudboardGenerateInput = z.infer<typeof claudboardGenerateInputSchema>
