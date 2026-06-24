import { z } from 'zod'

export const PhaseStartSchema = z.object({
  num: z.number().int().positive(),
  title: z.string().min(1),
})

export const PhaseCompleteSchema = z.object({
  num: z.number().int().positive(),
})

export const CheckpointStartSchema = z.object({
  num: z.number().int().positive(),
  title: z.string().min(1),
})

export const CheckpointCompleteSchema = z.object({
  num: z.number().int().positive(),
})

export const AgentStartSchema = z.object({
  name: z.string().min(1),
  op: z.string().min(1),
})

export const AgentCompleteSchema = z.object({
  name: z.string().min(1),
})

export const SpecPlanGatePayloadSchema = z.object({
  ticket: z.string().min(1),
  workspaceRoot: z.string().min(1),
  specDir: z.string().min(1),
  specFiles: z.array(z.string().min(1)).min(1),
  planPath: z.string().min(1),
})

export const GateRequestSchema = z.object({
  kind: z.literal('spec+plan'),
  payload: SpecPlanGatePayloadSchema,
})

export type PhaseStartInput = z.infer<typeof PhaseStartSchema>
export type PhaseCompleteInput = z.infer<typeof PhaseCompleteSchema>
export type CheckpointStartInput = z.infer<typeof CheckpointStartSchema>
export type CheckpointCompleteInput = z.infer<typeof CheckpointCompleteSchema>
export type AgentStartInput = z.infer<typeof AgentStartSchema>
export type AgentCompleteInput = z.infer<typeof AgentCompleteSchema>
export type GateRequestInput = z.infer<typeof GateRequestSchema>
export type SpecPlanGatePayloadInput = z.infer<typeof SpecPlanGatePayloadSchema>

export const ClarifyQuestionOptionSchema = z.object({
  label: z.string().min(1).describe('Short answer label shown as the radio option text (e.g. "Yes", "No", "Unknown").'),
  description: z.string().optional().describe('Optional one-sentence elaboration on what choosing this option means.'),
})

export const ClarifyQuestionSchema = z.object({
  text: z.string().min(1).describe(
    'The question itself as a single, plain-text sentence ending with a "?". ' +
    'No markdown, no embedded headings, no inline code, no asterisks, no backticks. ' +
    'One focused ask only — do not pack multiple questions into this field.',
  ),
  group: z.string().optional().describe(
    'Short section header (2–5 words) that groups related questions into a named category, ' +
    'e.g. "Scope", "Timeline", "Integrations". Displayed as a chip above the question text. ' +
    'Omit if the question does not belong to a meaningful category.',
  ),
  why: z.string().optional().describe(
    'Optional one-sentence explanation of why this question matters or how the answer will be used, ' +
    'e.g. "This determines which cloud region we target." Displayed as italic explanatory text below the question.',
  ),
  options: z.array(ClarifyQuestionOptionSchema).optional().describe(
    'Provide a short list of mutually exclusive answer choices when the answer space is well-known and bounded. ' +
    'Omit for open-ended questions where a free-text answer is more appropriate.',
  ),
})

export const ClarifyRequestSchema = z.object({
  questions: z.array(z.union([z.string().min(1), ClarifyQuestionSchema])).min(1),
})

export type ClarifyQuestionOptionInput = z.infer<typeof ClarifyQuestionOptionSchema>
export type ClarifyQuestionInput = z.infer<typeof ClarifyQuestionSchema>
export type ClarifyRequestInput = z.infer<typeof ClarifyRequestSchema>
