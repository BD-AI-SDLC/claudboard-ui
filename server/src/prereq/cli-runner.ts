import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { getDb } from '../db.js'
import { broadcast } from '../ws-server.js'
import { MODELS, type InteractiveQuestion, type SkillKey, type WsEvent } from '@bosch-sdlc/protocol'

const STDERR_TAIL_BYTES = 2 * 1024

// claudboard registers its slash commands as `<plugin>:<skill>` — `/analyse`
// alone is not resolvable. Map our short cmd names to the fully-qualified
// slash command the CLI expects.
const CMD_TO_SLASH: Record<string, string> = {
  analyse: '/claudboard:claudboard-analyse',
  generate: '/claudboard:claudboard-generate',
  workflow: '/claudboard:claudboard-workflow',
  refresh: '/claudboard:claudboard-refresh',
  techdebt: '/claudboard:claudboard-techdebt',
}

/**
 * Per-run in-memory state for the bidirectional CLI subprocess. The stdin
 * handle lets us write tool_result messages back when the UI answers a
 * pending AskUserQuestion. Entries are populated on spawn and removed on
 * subprocess exit (or error).
 */
interface RunRegistryEntry {
  stdin: Writable
  pendingQuestions: Map<string, InteractiveQuestion[]>
  /** Set true when the child's stdin emits 'error' (typically EPIPE on
   * subprocess death). submitCliAnswer checks this to short-circuit before
   * attempting a doomed write. */
  stdinBroken: boolean
}
const runRegistry = new Map<string, RunRegistryEntry>()

export type SubmitCliAnswerResult =
  | { ok: true }
  | { ok: false; reason: 'unknown-run' | 'unknown-tool-use' | 'run-exited' }

function truncateTail(s: string, max: number): string {
  if (Buffer.byteLength(s, 'utf8') <= max) return s
  const buf = Buffer.from(s, 'utf8')
  return '[truncated]\n' + buf.subarray(buf.length - max).toString('utf8')
}

function appendTranscriptLine(transcriptPath: string, rawLine: string): void {
  mkdirSync(dirname(transcriptPath), { recursive: true })
  appendFileSync(transcriptPath, rawLine + '\n')
}

function streamLines(stream: Readable, onLine: (line: string) => void): void {
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    buffer += chunk
    let idx = buffer.indexOf('\n')
    while (idx !== -1) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      if (line.length > 0) onLine(line)
      idx = buffer.indexOf('\n')
    }
  })
  stream.on('end', () => {
    const tail = buffer.trim()
    if (tail.length > 0) onLine(tail)
  })
}

/**
 * Inspects a parsed stream-json line for assistant `tool_use` blocks where
 * `name === 'AskUserQuestion'`. Returns the (toolUseId, questions) pairs in
 * the line, empty array when none.
 */
function extractAskUserQuestions(
  parsed: unknown,
): Array<{ toolUseId: string; questions: InteractiveQuestion[] }> {
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { type?: unknown }).type !== 'assistant'
  ) {
    return []
  }
  const message = (parsed as { message?: { content?: unknown } }).message
  const content = message?.content
  if (!Array.isArray(content)) return []

  const found: Array<{ toolUseId: string; questions: InteractiveQuestion[] }> = []
  for (const block of content) {
    if (
      typeof block !== 'object' ||
      block === null ||
      (block as { type?: unknown }).type !== 'tool_use' ||
      (block as { name?: unknown }).name !== 'AskUserQuestion'
    ) {
      continue
    }
    const id = (block as { id?: unknown }).id
    const input = (block as { input?: { questions?: unknown } }).input
    if (typeof id !== 'string' || !input || !Array.isArray(input.questions)) continue
    found.push({ toolUseId: id, questions: input.questions as InteractiveQuestion[] })
  }
  return found
}

/**
 * Executes a claudboard prereq slash command via the Claude Code CLI in
 * bidirectional stream-json mode.
 *
 * Spawns `claude --print --input-format stream-json --output-format stream-json
 * --verbose --replay-user-messages --permission-mode bypassPermissions` with
 * cwd=target, writes the slash command as the first stdin user message, then
 * streams stdout line-by-line. Each line is appended to the run's transcript,
 * parsed, and broadcast as a transcript-message WS event. Assistant tool_use
 * calls of name "AskUserQuestion" are additionally registered as pending
 * questions and broadcast as `interactive-question` events; the subprocess
 * waits on its open stdin until the UI delivers an answer via
 * `submitCliAnswer()`.
 *
 * Resolves on subprocess exit regardless of success/failure so callers can
 * chain post-completion logic (e.g. re-detecting prereqs from the filesystem).
 */
export function runPrereqViaCli(
  runId: string,
  target: string,
  cmd: string,
): Promise<void> {
  const db = getDb()
  const transcriptRow = db
    .prepare('SELECT transcript_path FROM runs WHERE id = ?')
    .get(runId) as { transcript_path: string } | undefined
  if (!transcriptRow) {
    return Promise.reject(new Error(`Run ${runId} not found`))
  }
  const transcriptPath = transcriptRow.transcript_path

  const slashCommand = CMD_TO_SLASH[cmd]
  if (!slashCommand) {
    markFailed(db, runId, `Internal error: no slash command mapping for "${cmd}"`)
    return Promise.resolve()
  }

  const model = MODELS[cmd as SkillKey]
  if (!model) {
    markFailed(db, runId, `Internal error: no model pinned for "${cmd}"`)
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    let child: ChildProcessByStdio<Writable, Readable, Readable>
    try {
      console.info(`[run ${runId}] model=${model} skill=${cmd}`)
      child = spawn(
        'claude',
        [
          '--print',
          '--model', model,
          '--input-format', 'stream-json',
          '--output-format', 'stream-json',
          '--verbose',
          '--replay-user-messages',
          // --print runs non-interactively, so the default permission prompts
          // can never be answered. Bypass them — same posture as the SDK's
          // runFeature path (permissionMode: 'bypassPermissions').
          '--permission-mode', 'bypassPermissions',
        ],
        { cwd: target, stdio: ['pipe', 'pipe', 'pipe'] },
      ) as ChildProcessByStdio<Writable, Readable, Readable>
    } catch (err) {
      markFailed(db, runId, `Failed to spawn claude: ${(err as Error).message}`)
      return resolve()
    }

    // Register stdin + empty pending-question map so the answer endpoint can
    // find us. Cleared on exit/error below.
    const entry: RunRegistryEntry = {
      stdin: child.stdin,
      pendingQuestions: new Map(),
      stdinBroken: false,
    }
    runRegistry.set(runId, entry)

    // EPIPE on stdin is normal when the subprocess dies mid-write. Swallow
    // it and mark the entry so future submitCliAnswer calls short-circuit.
    child.stdin.on('error', () => {
      entry.stdinBroken = true
    })

    // Write the slash command as the first user message — argv positional is
    // not accepted in --input-format stream-json mode.
    try {
      child.stdin.write(
        JSON.stringify({ type: 'user', message: { role: 'user', content: slashCommand } }) + '\n',
      )
    } catch (err) {
      runRegistry.delete(runId)
      markFailed(db, runId, `Failed to write initial prompt: ${(err as Error).message}`)
      return resolve()
    }

    let stderr = ''
    let spawnFailed = false

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    streamLines(child.stdout, (line) => {
      // Persist verbatim regardless of parse success.
      appendTranscriptLine(transcriptPath, line)

      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        console.warn(`[cli-runner] malformed stream-json line for run ${runId}; skipping broadcast`)
        return
      }

      const event: WsEvent = {
        run_id: runId,
        t: new Date().toISOString(),
        kind: 'transcript-message',
        payload: { message: parsed },
      }
      broadcast(runId, event)

      // After broadcasting the raw message, surface any embedded
      // AskUserQuestion tool_use as a typed interactive-question event so the
      // UI can render an inline question card without re-parsing transcript.
      const questions = extractAskUserQuestions(parsed)
      const entry = runRegistry.get(runId)
      for (const q of questions) {
        if (entry) entry.pendingQuestions.set(q.toolUseId, q.questions)
        const qEvent: WsEvent = {
          run_id: runId,
          t: new Date().toISOString(),
          kind: 'interactive-question',
          payload: { toolUseId: q.toolUseId, questions: q.questions },
        }
        broadcast(runId, qEvent)
      }

      // The CLI emits a `result` message when the session is done from its
      // perspective. In bidirectional stream-json mode it then keeps reading
      // stdin forever waiting for the next user turn — so the subprocess
      // never exits unless WE close stdin. End it here so the existing exit
      // handler can fire and mark the run done.
      if (typeof parsed === 'object' && parsed !== null && (parsed as { type?: unknown }).type === 'result') {
        if (entry && !entry.stdin.writableEnded) {
          try { entry.stdin.end() } catch { /* swallow — exit handler will cope */ }
        }
      }
    })

    child.once('error', (err) => {
      spawnFailed = true
      runRegistry.delete(runId)
      markFailed(db, runId, `Failed to spawn claude: ${err.message}`)
      resolve()
    })

    child.once('exit', (code) => {
      runRegistry.delete(runId)
      if (spawnFailed) return // already resolved in 'error'
      if (code === 0) {
        markDone(db, runId)
      } else {
        const reason = stderr.trim() || `claude exited ${code}`
        markFailed(db, runId, truncateTail(reason, STDERR_TAIL_BYTES))
      }
      resolve()
    })
  })
}

/**
 * Writes a stream-json `tool_result` message back to the running subprocess's
 * stdin to answer a pending AskUserQuestion. The `answers` array carries one
 * `{ answer }` per question in the original tool_use (single-element for the
 * common single-question case; multi-element for compound questions). All
 * answers are joined with newlines into the tool_result `content` string.
 *
 * Returns `{ ok: true }` on a successful write, otherwise an error reason:
 * - `unknown-run`     — no live registry entry for this runId (never started,
 *                       already exited, or never existed)
 * - `unknown-tool-use`— registry exists but this toolUseId is not pending
 *                       (already answered, or never seen)
 * - `run-exited`      — stdin write threw mid-flight (subprocess exited
 *                       between lookup and write)
 */
export function submitCliAnswer(
  runId: string,
  toolUseId: string,
  answers: Array<{ answer: string }>,
): SubmitCliAnswerResult {
  const entry = runRegistry.get(runId)
  if (!entry) return { ok: false, reason: 'unknown-run' }
  if (!entry.pendingQuestions.has(toolUseId)) return { ok: false, reason: 'unknown-tool-use' }
  if (entry.stdinBroken || entry.stdin.destroyed || entry.stdin.writableEnded) {
    return { ok: false, reason: 'run-exited' }
  }

  const content = answers.map((a) => a.answer).join('\n')
  const message = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: toolUseId, content, is_error: false },
      ],
    },
  }

  try {
    entry.stdin.write(JSON.stringify(message) + '\n')
  } catch {
    // The subprocess likely exited between our lookup and write.
    return { ok: false, reason: 'run-exited' }
  }

  entry.pendingQuestions.delete(toolUseId)
  return { ok: true }
}

function markDone(db: ReturnType<typeof getDb>, runId: string): void {
  db.prepare("UPDATE runs SET status='done', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(runId)
  const event: WsEvent = {
    run_id: runId,
    t: new Date().toISOString(),
    kind: 'status-change',
    payload: { status: 'done' },
  }
  broadcast(runId, event)
}

function markFailed(db: ReturnType<typeof getDb>, runId: string, errorMessage: string): void {
  db.prepare(
    "UPDATE runs SET status='failed', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), error_message=? WHERE id=?",
  ).run(errorMessage, runId)
  const event: WsEvent = {
    run_id: runId,
    t: new Date().toISOString(),
    kind: 'status-change',
    payload: { status: 'failed' },
  }
  broadcast(runId, event)
}

/**
 * Used by the route handler to downgrade a code-0 exit to failed when the
 * expected output artifact was not actually written. Mirrors markFailed but
 * does not change completed_at (already set by markDone).
 */
export function downgradeToFailed(runId: string, errorMessage: string): void {
  const db = getDb()
  db.prepare("UPDATE runs SET status='failed', error_message=? WHERE id=?").run(errorMessage, runId)
  const event: WsEvent = {
    run_id: runId,
    t: new Date().toISOString(),
    kind: 'status-change',
    payload: { status: 'failed' },
  }
  broadcast(runId, event)
}
