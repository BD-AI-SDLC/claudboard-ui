import { z } from 'zod'
import { stubbableString } from './common.js'

const jiraSchema = z.object({
  cloudId: stubbableString,
  projectKey: stubbableString,
  urlBase: stubbableString,
  customFields: z.object({
    sprint: z.string().default('customfield_10001'),
    acceptanceCriteria: z.string().default('customfield_12206'),
  }).optional(),
  transitions: z.object({
    start: z.string().default('In Progress'),
    success: z.string().default('In Review'),
    failure: z.string().default('Blocked'),
  }).optional(),
})

const trSchema = z.object({
  baseUrl: stubbableString,
  projectKey: stubbableString,
  transitions: z.object({
    start: z.string().default('In Progress'),
    success: z.string().default('In Review'),
    failure: z.string().default('Blocked'),
  }).optional(),
})

const azureDevOpsSchema = z.object({
  org: stubbableString,
  project: stubbableString,
  repositoryId: stubbableString,
})

const githubSchema = z.object({
  owner: stubbableString,
  repo: stubbableString,
  linkingKeyword: z.string().default('Closes'),
})

const gitSchema = z.object({
  branchTypes: z.array(z.string()).default(['feature', 'bugfix', 'hotfix']),
  branchPattern: z.string().default('{type}/{ticket}/{slug}'),
  ticketRegex: z.string().default('[A-Z]+-[0-9]+'),
})

// Base ZodObject (no superRefine) — exported for extending in discriminated unions
export const claudboardWorkflowBaseSchema = z.object({
  tracker: z.enum(['jira', 'tr']),
  repo: z.enum(['ado', 'github']),
  jira: jiraSchema.optional(),
  tr: trSchema.optional(),
  azureDevOps: azureDevOpsSchema.optional(),
  github: githubSchema.optional(),
  git: gitSchema.optional(),
})

export type ClaudboardWorkflowBase = z.infer<typeof claudboardWorkflowBaseSchema>

export function claudboardWorkflowRefine(
  val: ClaudboardWorkflowBase,
  ctx: z.RefinementCtx,
): void {
  if (val.tracker === 'jira' && !val.jira) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'jira configuration is required when tracker is "jira"',
      path: ['jira'],
    })
  }
  if (val.tracker === 'tr' && !val.tr) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tr configuration is required when tracker is "tr"',
      path: ['tr'],
    })
  }
  if (val.repo === 'ado' && !val.azureDevOps) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'azureDevOps configuration is required when repo is "ado"',
      path: ['azureDevOps'],
    })
  }
  if (val.repo === 'github' && !val.github) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'github configuration is required when repo is "github"',
      path: ['github'],
    })
  }
}

export const claudboardWorkflowInputSchema = claudboardWorkflowBaseSchema.superRefine(
  claudboardWorkflowRefine,
)

export type ClaudboardWorkflowInput = z.infer<typeof claudboardWorkflowInputSchema>
