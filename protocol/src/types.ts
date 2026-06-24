/**
 * `'cancelled'` is user-initiated terminal status, set by `POST /api/runs/:id/stop`.
 * Distinct from `'dead'`, which is reserved for the boot-sweep recovery target.
 * Cancelled runs survive server restart and are never resumed.
 */
export type RunStatus = 'running' | 'paused-gate' | 'paused-user' | 'cancelled' | 'done' | 'failed' | 'dead'
export type PrereqState = 'done' | 'stale' | 'missing'
/**
 * Reason a prereq is `stale`. `aged-out` — artifact older than the freshness window.
 * `codebase-changed` — git tracks commits since the artifact's mtime. Only `techdebt`
 * emits a stale reason; foundation rows always persist `null`. `null` whenever
 * `state !== 'stale'` and for legacy rows persisted before this field existed.
 */
export type StaleReason = 'aged-out' | 'codebase-changed'
export type Topology = 'monolith' | 'monorepo' | 'multi-repo-workspace'
export type ClaudboardSkill = 'analyse' | 'generate' | 'workflow'
export type RunKind = 'feature' | 'prereq' | `claudboard-${ClaudboardSkill}`
export type Autonomy = 'autopilot' | 'balanced' | 'guided' | 'manual'
export const AUTONOMY_VALUES: readonly Autonomy[] = ['autopilot', 'balanced', 'guided', 'manual'] as const
export const DEFAULT_AUTONOMY: Autonomy = 'balanced'

export interface Project {
  id: string
  path: string
  name: string
  topology: Topology
  mark: string
  status: 'active' | 'detached'
  createdAt: string
  lastActiveAt: string | null
}

export interface Repo {
  id: string
  projectId: string
  path: string
  name: string
  topology: Topology
  status: 'active' | 'detached'
  prereqs: Record<string, PrereqRecord>
  /** Default autonomy level for new runs, read from this repo's `.claude/skills/feature-workflow/config.json` (`clarify.defaultAutonomy`). Always one of the four valid values; the server normalises invalid/missing config to `'balanced'`. */
  defaultAutonomy: Autonomy
  /**
   * Project key resolved from this repo's `.claude/skills/feature-workflow/config.json`:
   * `jira.projectKey` when `tracker: 'jira'`, `tr.projectKey` when `tracker: 'tr'`.
   * `null` when the file is missing/unparseable, when the tracker is missing/unknown,
   * or when the key is missing, empty, the `__stub__` sentinel, or starts with `[TODO:`.
   * Used by the Kickoff branch preview; when `null`, the UI renders a placeholder
   * rather than fabricating a key.
   */
  featureWorkflowProjectKey: string | null
}

export interface PrereqRecord {
  id: string
  repoId: string
  cmd: 'analyse' | 'generate' | 'workflow' | 'refresh' | 'techdebt'
  state: PrereqState
  lastRun: string | null    // ISO timestamp
  duration: number | null   // milliseconds
  cost: number | null
  output: string | null     // relative path to primary output artifact
  /** Populated only when `state === 'stale'`; null otherwise and for legacy rows. */
  staleReason: StaleReason | null
}

export interface PhaseCost {
  phaseNum: number
  phaseTitle: string
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  apiCalls: number
  model: string
}

export interface Run {
  id: string
  repoId: string
  kind: RunKind
  status: RunStatus
  prompt: string
  target: string
  transcriptPath: string
  createdAt: string
  completedAt: string | null
  cost: number | null
  costUsd: number | null
  inputTokens: number | null
  outputTokens: number | null
  /** Autonomy level the user selected at Kickoff. Passed to the SKILL via the `--autonomy=<level>` flag in the initial prompt. */
  autonomy: Autonomy
  /** Populated when status='failed' with a short reason (truncated stderr tail, or a downgrade explanation). */
  errorMessage: string | null
  phaseCosts: PhaseCost[]
  openGate?: Gate | null
}

export type BootstrapStatus = 'ready' | 'installing' | 'cli-missing' | 'install-failed'
export interface BootstrapStatusResponse { state: BootstrapStatus; message?: string }

export interface Gate {
  id: string
  runId: string
  kind: GateKind
  payload: GatePayload
  snapshot?: SpecPlanGateSnapshot | null
  status: 'open' | 'resolved'
  resolution: GateResolution | null
  createdAt: string
  resolvedAt: string | null
}

export interface SpecPlanGatePayload {
  ticket: string
  workspaceRoot: string
  specDir: string
  specFiles: string[]
  planPath: string
}

export interface ClarifyQuestionOption { label: string; description?: string }
export interface ClarifyQuestion { text: string; group?: string; why?: string; options?: ClarifyQuestionOption[] }
export interface ClarifyGatePayload {
  questions: Array<string | ClarifyQuestion>
}

export type GatePayload = SpecPlanGatePayload | ClarifyGatePayload

export type ClarifyPayload = ClarifyGatePayload

export type GateKind = 'spec+plan' | 'clarify'

export interface GateFileSnapshot {
  path: string
  content: string
  size: number
  mtime: string
  drifted?: boolean
}

export interface SpecPlanGateSnapshot {
  workspaceRoot: string
  specDir: string
  specFiles: GateFileSnapshot[]
  plan: GateFileSnapshot | null
}

export interface SpecPlanGateEventPayload extends SpecPlanGatePayload {
  snapshot: SpecPlanGateSnapshot
}

export interface GateFileLiveResponse {
  path: string
  content: string
  size: number
  mtime: string
  drifted: boolean
  snapshotMtime: string
}

export interface ClarifyAnswer { selected?: number; note?: string }
export type ApprovalResolution = { result: 'approved' | 'rejected'; changes?: string }
export type ClarifyResolution = { answers: Array<string | ClarifyAnswer> } | { skipped: true }
export type GateResolution = ApprovalResolution | ClarifyResolution

// REST API request/response shapes
export interface CreateProjectRequest {
  root: string
  mark?: string
}

export interface ActiveProjectResponse {
  activeProjectId: string | null
  activeProject: Project | null
}
export interface CreateRunRequest {
  repoId: string
  prompt: string
  target: string
  /** Selected at Kickoff; passed to the SKILL via the `--autonomy=<level>` flag in the initial prompt. */
  autonomy: Autonomy
}
export type ResolveGateRequest = GateResolution
export interface RunPrereqRequest { target: string }

/**
 * Mirrors the AskUserQuestion tool input schema. Emitted by the prereq CLI
 * subprocess when an interactive skill needs to gather config from the user.
 */
export interface InteractiveQuestionOption { label: string; description?: string }
export interface InteractiveQuestion {
  question: string
  header?: string
  multiSelect?: boolean
  options: InteractiveQuestionOption[]
}

/**
 * Body for `POST /api/runs/:id/cli-answer`. `answers` carries the user's
 * selected option label(s) for the question identified by `toolUseId`. An
 * empty array means "skip".
 */
export interface CliAnswerRequest {
  toolUseId: string
  answers: Array<{ answer: string }>
}

export interface DashboardSummary {
  activeRuns: number
  awaitingGate: number
  inReview: number
  mergedThisWeek: number
}
