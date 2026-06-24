import type {
  Project, Repo, Run, Gate, DashboardSummary, WsEvent,
  CreateRunRequest, ResolveGateRequest, RunPrereqRequest,
  BootstrapStatusResponse, CliAnswerRequest,
  ActiveProjectResponse, CreateProjectRequest,
} from '@bosch-sdlc/protocol'
export { fetchClaudboardAvailability, launchClaudboardRun } from './claudboard.js'
export type { ClaudboardAvailability } from './claudboard.js'

const BASE = ''  // same-origin

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  // Projects (top-level)
  getProjects: () => request<Project[]>('/api/projects'),
  createProject: (body: CreateProjectRequest) =>
    request<Project & { detectedTopology?: string }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteProject: (id: string) =>
    request<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  getActiveProject: () => request<ActiveProjectResponse>('/api/projects/active'),
  setActiveProject: (projectId: string) => request<{ activeProjectId: string; activeProject: Project }>('/api/projects/active', {
    method: 'PUT',
    body: JSON.stringify({ projectId }),
  }),

  // Repos (per-git-repo within a project)
  getRepos: (projectId: string) => request<Repo[]>(`/api/repos?projectId=${encodeURIComponent(projectId)}`),
  getRepo: (id: string) => request<Repo>(`/api/repos/${id}`),
  getRepoPrereqs: (id: string) => request<Repo['prereqs']>(`/api/repos/${id}/prereqs`),

  // Runs
  createRun: (body: CreateRunRequest) =>
    request<Run>('/api/runs', { method: 'POST', body: JSON.stringify(body) }),
  getRun: (id: string) => request<Run>(`/api/runs/${id}`),
  getRuns: (projectId: string) => request<Run[]>(`/api/runs?projectId=${encodeURIComponent(projectId)}`),
  getRunEvents: (id: string) => request<WsEvent[]>(`/api/runs/${id}/events`),
  pauseRun: (id: string) => request<void>(`/api/runs/${id}/pause`, { method: 'POST' }),
  resumeRun: (id: string) => request<void>(`/api/runs/${id}/resume`, { method: 'POST' }),
  stopRun: (id: string) => request<void>(`/api/runs/${id}/stop`, { method: 'POST' }),

  // Gates
  resolveGate: (runId: string, gateId: string, body: ResolveGateRequest) =>
    request<Gate>(`/api/runs/${runId}/gate/${gateId}/resolve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Prereqs
  runPrereq: (cmd: string, body: RunPrereqRequest) =>
    request<Run>(`/api/prereqs/${cmd}`, { method: 'POST', body: JSON.stringify(body) }),

  // Submit a user answer for a pending AskUserQuestion in a live prereq run.
  submitCliAnswer: (runId: string, body: CliAnswerRequest) =>
    request<{ ok: true }>(`/api/runs/${runId}/cli-answer`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Dashboard
  getDashboardSummary: () => request<DashboardSummary>('/api/dashboard/summary'),

  // Bootstrap (silent plugin install state)
  getBootstrapStatus: () => request<BootstrapStatusResponse>('/api/bootstrap/status'),
  retryBootstrap: () =>
    request<BootstrapStatusResponse>('/api/bootstrap/retry', { method: 'POST' }),

  // Filesystem browser
  browseFs: (path?: string) => {
    const url = path ? `/api/fs/browse?path=${encodeURIComponent(path)}` : '/api/fs/browse'
    return request<{ path: string; parent: string | null; entries: Array<{ name: string; path: string; isGitRepo: boolean }> }>(url)
  },
}
