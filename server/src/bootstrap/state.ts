import type { BootstrapStatus, BootstrapStatusResponse } from '@bosch-sdlc/protocol'
import { isClaudboardInstalled, isClaudeCliPresent } from './plugin-check.js'
import { installClaudboard } from './installer.js'

interface InternalState {
  state: BootstrapStatus
  message?: string
}

let current: InternalState = { state: 'installing' }
let inFlight: Promise<void> | null = null

const MESSAGES: Record<Exclude<BootstrapStatus, 'ready'>, string> = {
  installing: 'bosch-sdlc is still setting up. Please wait a few seconds and try again.',
  'cli-missing': 'Claude Code is not installed. Visit https://claude.com/download to install it, then restart bosch-sdlc.',
  'install-failed': 'Plugin install failed. Click Retry on the dashboard.',
}

export function getBootstrapStatus(): BootstrapStatusResponse {
  const r: BootstrapStatusResponse = { state: current.state }
  if (current.message !== undefined) r.message = current.message
  return r
}

export function getBootstrapMessageFor(state: Exclude<BootstrapStatus, 'ready'>): string {
  // Prefer the live message (which carries actual stderr for install-failed)
  // when the requested state matches the current state.
  if (current.state === state && current.message) return current.message
  return MESSAGES[state]
}

// Test-only helpers — exported so unit tests can drive the state machine without
// spawning subprocesses. Not part of the public API.
export function __setStateForTest(next: InternalState): void {
  current = next
}
export function __resetForTest(): void {
  current = { state: 'installing' }
  inFlight = null
}

/**
 * Drives the bootstrap state machine. Idempotent: concurrent or repeated calls
 * while an install is in flight return the same promise. Calls while state is
 * already `ready` or `cli-missing` resolve immediately without re-spawning.
 *
 * Designed to be invoked at server start as fire-and-forget — the HTTP server
 * is up and answering `/api/bootstrap/status` while this resolves.
 */
export function runBootstrap(): Promise<void> {
  if (inFlight) return inFlight
  if (current.state === 'ready' || current.state === 'cli-missing') return Promise.resolve()

  inFlight = (async () => {
    const cliOk = await isClaudeCliPresent()
    if (!cliOk) {
      current = { state: 'cli-missing', message: MESSAGES['cli-missing'] }
      return
    }
    if (isClaudboardInstalled()) {
      current = { state: 'ready' }
      return
    }
    current = { state: 'installing', message: MESSAGES.installing }
    const result = await installClaudboard()
    if (result.ok) {
      current = { state: 'ready' }
    } else {
      current = {
        state: 'install-failed',
        message: result.stderr ?? 'Plugin install failed for an unknown reason.',
      }
    }
  })().finally(() => {
    inFlight = null
  })

  return inFlight
}

/**
 * Reruns bootstrap from an `install-failed` state. Returns the post-call state
 * snapshot so the route handler can echo it back. Returns null if called from a
 * non-install-failed state (caller should 409).
 */
export function retryBootstrap(): Promise<BootstrapStatusResponse> | null {
  if (current.state !== 'install-failed') return null
  current = { state: 'installing', message: MESSAGES.installing }
  // Fire-and-forget the actual rerun; the caller observes via polling.
  void runBootstrap()
  return Promise.resolve(getBootstrapStatus())
}
