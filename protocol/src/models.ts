export const MODELS = {
  analyse:  'claude-opus-4-7[1m]',
  generate: 'claude-sonnet-4-6[1m]',
  workflow: 'claude-sonnet-4-6[1m]',
  refresh:  'claude-opus-4-7[1m]',
  techdebt: 'claude-opus-4-7[1m]',
  feature:  'claude-sonnet-4-6[1m]',
} as const

export type SkillKey = keyof typeof MODELS
export type PinnedModel = (typeof MODELS)[SkillKey]
