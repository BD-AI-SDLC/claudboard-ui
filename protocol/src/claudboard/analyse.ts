import { z } from 'zod'

export const claudboardAnalyseInputSchema = z.object({
  ecosystemLevel: z.boolean().default(false),
  acceptTopology: z.boolean().default(true),
})

export type ClaudboardAnalyseInput = z.infer<typeof claudboardAnalyseInputSchema>
