import type { ClaudboardLaunchRequest } from '@bosch-sdlc/protocol'

const BASE = ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  return res.json() as Promise<T>
}

export interface ClaudboardAvailability {
  installed: boolean
  installHint?: string
}

export function fetchClaudboardAvailability(): Promise<ClaudboardAvailability> {
  return request<ClaudboardAvailability>('/api/claudboard/availability')
}

export function launchClaudboardRun(
  repoId: string,
  inputs: ClaudboardLaunchRequest,
): Promise<{ runId: string }> {
  return request<{ runId: string }>('/api/claudboard/run', {
    method: 'POST',
    body: JSON.stringify({ repoId, ...inputs }),
  })
}
