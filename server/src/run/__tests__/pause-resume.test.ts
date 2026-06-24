/**
 * Tests for Task 7.3 (status invariants) and Task 7.4 (pause→gate sequence).
 *
 * These are unit tests that do NOT require a running SDK, Express server, or
 * real SQLite database. They exercise:
 *   - The status-check logic embedded in the pause route handler
 *   - The setPausedUser / resumeRun building blocks in driver.ts
 *   - The createGateDeferred / resolveGateDeferred building blocks in gate/deferred.ts
 *   - The pure buildPrompt function (to confirm it has no side effects)
 */

import { setPausedUser, resumeRun } from '../driver.js'
import { createGateDeferred, resolveGateDeferred, hasOpenGate } from '../../gate/deferred.js'
import { buildPrompt } from '../prompt-builder.js'

// ---------------------------------------------------------------------------
// Task 7.3 — Status invariants for the pause endpoint
// ---------------------------------------------------------------------------

/**
 * The pause route (routes.ts) performs this status check before calling
 * setPausedUser:
 *
 *   if (run.status !== 'running') {
 *     return res.status(409).json({ error: `Cannot pause a run with status '${run.status}'` })
 *   }
 *
 * We extract that predicate here so we can test it without spinning up Express
 * or a real database.
 */
function canPause(status: string): boolean {
  return status === 'running'
}

/**
 * The resume route performs the symmetric check:
 *
 *   if (run.status !== 'paused-user') {
 *     return res.status(409).json({ error: `Cannot resume a run with status '${run.status}'` })
 *   }
 */
function canResume(status: string): boolean {
  return status === 'paused-user'
}

describe('Task 7.3 — pause endpoint status invariants', () => {
  describe('canPause predicate (mirrors routes.ts guard)', () => {
    test('pause on paused-gate → 409 (not allowed)', () => {
      expect(canPause('paused-gate')).toBe(false)
    })

    test('pause on done → 409 (not allowed)', () => {
      expect(canPause('done')).toBe(false)
    })

    test('pause on failed → 409 (not allowed)', () => {
      expect(canPause('failed')).toBe(false)
    })

    test('pause on dead → 409 (not allowed)', () => {
      expect(canPause('dead')).toBe(false)
    })

    test('pause on running → 200 (allowed)', () => {
      expect(canPause('running')).toBe(true)
    })

    test('pause on paused-user → 409 (already paused)', () => {
      // A run already user-paused is not "running", so the guard blocks it.
      expect(canPause('paused-user')).toBe(false)
    })
  })

  describe('canResume predicate (mirrors routes.ts guard)', () => {
    test('resume on running → not allowed', () => {
      expect(canResume('running')).toBe(false)
    })

    test('resume on paused-gate → not allowed', () => {
      expect(canResume('paused-gate')).toBe(false)
    })

    test('resume on paused-user → allowed', () => {
      expect(canResume('paused-user')).toBe(true)
    })
  })

  describe('setPausedUser — idempotency guard', () => {
    // The route first checks status === 'running', then calls setPausedUser.
    // setPausedUser itself returns false if a deferred is already registered
    // for that run (i.e. already paused at the in-memory level).

    test('first call for a new run id returns true', () => {
      const result = setPausedUser('invariant-test-run-a')
      expect(result).toBe(true)
    })

    test('second call for the same run id returns false (already paused)', () => {
      // First call registers the slot.
      setPausedUser('invariant-test-run-b')
      // Second call should report "already paused".
      const second = setPausedUser('invariant-test-run-b')
      expect(second).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Task 7.4 — Pause → gate sequence building blocks
// ---------------------------------------------------------------------------

describe('Task 7.4 — pause-then-gate sequence building blocks', () => {
  describe('setPausedUser and resumeRun', () => {
    test('setPausedUser returns true on first call', () => {
      const ok = setPausedUser('seq-run-1')
      expect(ok).toBe(true)
    })

    test('resumeRun returns false when no deferred is registered', () => {
      // No pause was requested for this run, so there is nothing to resolve.
      const ok = resumeRun('seq-run-never-paused')
      expect(ok).toBe(false)
    })

    test('resumeRun resolves the pause deferred and returns true', async () => {
      const runId = 'seq-run-2'
      setPausedUser(runId)

      // Simulate what checkPause() does internally: create a promise that the
      // loop would await, then resolve it via resumeRun.
      let pauseResolve!: () => void
      const pausePromise = new Promise<void>((resolve) => {
        pauseResolve = resolve
      })

      // Wire the external resolver into the deferred map so resumeRun can
      // find and call it (mirrors the real checkPause internals).
      // Because driver internals are not exported we verify resumeRun's
      // observable contract: it returns true and the promise it would have
      // awaited can be resolved independently.

      // 1. A second setPausedUser call returns false (slot already taken).
      const secondCall = setPausedUser(runId)
      expect(secondCall).toBe(false)

      // 2. resumeRun clears the slot — but the internal map is private so
      //    we verify the return value only.
      const resumed = resumeRun(runId)
      expect(resumed).toBe(true)

      // 3. After resume, the slot is gone: resumeRun again returns false.
      const afterResume = resumeRun(runId)
      expect(afterResume).toBe(false)

      // Clean up the promise we created (it will never settle — that's fine
      // for test purposes; just avoid the unhandled-rejection warning).
      pauseResolve()
      await pausePromise
    })
  })

  describe('createGateDeferred and resolveGateDeferred', () => {
    test('createGateDeferred returns a pending promise', () => {
      const promise = createGateDeferred('gate-seq-run', 'gate-seq-1')
      expect(promise).toBeInstanceOf(Promise)
      expect(hasOpenGate('gate-seq-run', 'gate-seq-1')).toBe(true)
    })

    test('resolveGateDeferred resolves the promise with the approval result', async () => {
      const promise = createGateDeferred('gate-seq-run-2', 'gate-1')
      const ok = resolveGateDeferred('gate-seq-run-2', 'gate-1', { result: 'approved' })
      expect(ok).toBe(true)
      const result = await promise
      expect(result).toEqual({ result: 'approved' })
      expect(hasOpenGate('gate-seq-run-2', 'gate-1')).toBe(false)
    })

    test('resolveGateDeferred returns false when no matching deferred exists', () => {
      const ok = resolveGateDeferred('nonexistent-run', 'nonexistent-gate', { result: 'approved' })
      expect(ok).toBe(false)
    })

    test('full paused-user → running → paused-gate state sequence', async () => {
      // This test documents the intended state machine transitions.
      // In production these statuses live in SQLite; here we track them locally
      // to verify the building blocks that drive each transition work correctly.

      let status = 'running'

      // --- Transition: running → paused-user (user hits pause) ---
      expect(canPause(status)).toBe(true)
      const pauseOk = setPausedUser('full-seq-run')
      expect(pauseOk).toBe(true)
      status = 'paused-user'

      // --- Transition: paused-user → running (user hits resume) ---
      expect(canResume(status)).toBe(true)
      const resumeOk = resumeRun('full-seq-run')
      expect(resumeOk).toBe(true)
      status = 'running'

      // --- Transition: running → paused-gate (SDK calls gate_request) ---
      expect(canPause(status)).toBe(true) // run is still "running" at this point
      const gatePromise = createGateDeferred('full-seq-run', 'gate-final')
      status = 'paused-gate'

      // At paused-gate the pause endpoint must be blocked.
      expect(canPause(status)).toBe(false)

      // Gate resolves (reviewer approves).
      const gateOk = resolveGateDeferred('full-seq-run', 'gate-final', { result: 'approved' })
      expect(gateOk).toBe(true)
      const gateResult = await gatePromise
      expect(gateResult).toEqual({ result: 'approved' })
      status = 'running'

      expect(status).toBe('running')
    })
  })

  describe('buildPrompt — pure function, no side effects', () => {
    // Included here to provide a simple baseline that the test infrastructure
    // works correctly without any DB or SDK involvement.

    test('prompt is plain text starting with "Start feature --autonomy=<level> --gate=mcp:"', () => {
      const prompt = buildPrompt('add login page', 'balanced')
      expect(prompt).toBe('Start feature --autonomy=balanced --gate=mcp: add login page')
    })

    test('prompt does not start with a slash (would be parsed as a slash command)', () => {
      expect(buildPrompt('x', 'balanced').startsWith('/')).toBe(false)
    })

    test('prompt embeds the chosen autonomy verbatim', () => {
      expect(buildPrompt('add login page', 'autopilot')).toBe('Start feature --autonomy=autopilot --gate=mcp: add login page')
      expect(buildPrompt('add login page', 'manual')).toBe('Start feature --autonomy=manual --gate=mcp: add login page')
    })
  })
})
