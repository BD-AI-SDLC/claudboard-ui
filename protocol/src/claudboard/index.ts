import { z } from 'zod'
import { claudboardAnalyseInputSchema } from './analyse.js'
import { claudboardGenerateInputSchema } from './generate.js'
import { claudboardWorkflowBaseSchema, claudboardWorkflowRefine } from './workflow.js'

export { stubbableString } from './common.js'
export { claudboardAnalyseInputSchema, type ClaudboardAnalyseInput } from './analyse.js'
export { claudboardGenerateInputSchema, type ClaudboardGenerateInput } from './generate.js'
export {
  claudboardWorkflowInputSchema,
  claudboardWorkflowBaseSchema,
  claudboardWorkflowRefine,
  type ClaudboardWorkflowInput,
  type ClaudboardWorkflowBase,
} from './workflow.js'

const analyseEntry = claudboardAnalyseInputSchema.extend({ skill: z.literal('analyse') })
const generateEntry = claudboardGenerateInputSchema.extend({ skill: z.literal('generate') })
const workflowEntry = claudboardWorkflowBaseSchema
  .extend({ skill: z.literal('workflow') })
  .superRefine(claudboardWorkflowRefine)

export const claudboardLaunchRequest = z.discriminatedUnion('skill', [
  analyseEntry,
  generateEntry,
  workflowEntry,
])

export type ClaudboardLaunchRequest = z.infer<typeof claudboardLaunchRequest>
