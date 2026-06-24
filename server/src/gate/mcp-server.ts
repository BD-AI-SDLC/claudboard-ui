import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import type {
  GateFileSnapshot,
  SpecPlanGateEventPayload,
  SpecPlanGateSnapshot,
  WsEvent,
} from '@bosch-sdlc/protocol'
import {
  PhaseStartSchema,
  PhaseCompleteSchema,
  CheckpointStartSchema,
  CheckpointCompleteSchema,
  AgentStartSchema,
  AgentCompleteSchema,
  GateRequestSchema,
  SpecPlanGatePayloadSchema,
  ClarifyRequestSchema,
} from '@bosch-sdlc/protocol'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { broadcast } from '../ws-server.js'
import { createGateDeferred } from './deferred.js'
import { resolveUnderWorkspace } from './resolve-under-workspace.js'

const ok = () => ({ content: [{ type: 'text' as const, text: 'ok' }] })

const DEFAULT_MAX_FILE_BYTES = 1 * 1024 * 1024 // 1 MB

function getMaxFileBytes(): number {
  const envVal = process.env.BOSCH_GATE_MAX_FILE_BYTES
  if (!envVal) return DEFAULT_MAX_FILE_BYTES
  const n = Number.parseInt(envVal, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_FILE_BYTES
  return n
}

async function readGateFile(absPath: string, label: string): Promise<GateFileSnapshot> {
  const st = await stat(absPath)
  const max = getMaxFileBytes()
  if (st.size > max) {
    throw new Error(
      `File exceeds per-file size cap (${st.size} > ${max} bytes): ${label} → ${absPath}`,
    )
  }
  const content = await readFile(absPath, 'utf-8')
  return {
    path: absPath,
    content,
    size: st.size,
    mtime: st.mtime.toISOString(),
  }
}

async function buildSpecPlanSnapshot(payload: {
  workspaceRoot: string
  specDir: string
  specFiles: string[]
  planPath: string
}): Promise<SpecPlanGateSnapshot> {
  const { workspaceRoot, specDir, specFiles, planPath } = payload

  // Resolve specDir under workspaceRoot (defence in depth — every file is also
  // re-checked individually).
  await resolveUnderWorkspace(workspaceRoot, specDir)

  const resolvedSpecFiles: GateFileSnapshot[] = []
  for (const specFile of specFiles) {
    const abs = await resolveUnderWorkspace(workspaceRoot, join(specDir, specFile))
    resolvedSpecFiles.push(await readGateFile(abs, specFile))
  }

  const planAbs = await resolveUnderWorkspace(workspaceRoot, planPath)
  const plan = await readGateFile(planAbs, planPath)

  return {
    workspaceRoot,
    specDir,
    specFiles: resolvedSpecFiles,
    plan,
  }
}

export function createBoschMcpServer(
  runId: string,
  db: Database,
): McpSdkServerConfigWithInstance {
  const emit = <T>(kind: WsEvent['kind'], payload: T) => {
    const event = {
      run_id: runId,
      t: new Date().toISOString(),
      kind,
      payload,
    } as WsEvent
    broadcast(runId, event)
  }

  return createSdkMcpServer({
    name: 'bosch',
    tools: [
      tool(
        'phase_start',
        'Mark the start of a workflow phase.',
        PhaseStartSchema.shape,
        async (input) => {
          emit('phase-start', input)
          return ok()
        },
      ),
      tool(
        'phase_complete',
        'Mark a workflow phase as complete.',
        PhaseCompleteSchema.shape,
        async (input) => {
          emit('phase-complete', input)
          return ok()
        },
      ),
      tool(
        'checkpoint_start',
        'Mark the start of a checkpoint within a phase.',
        CheckpointStartSchema.shape,
        async (input) => {
          emit('checkpoint-start', input)
          return ok()
        },
      ),
      tool(
        'checkpoint_complete',
        'Mark a checkpoint as complete.',
        CheckpointCompleteSchema.shape,
        async (input) => {
          emit('checkpoint-complete', input)
          return ok()
        },
      ),
      tool(
        'agent_start',
        'Mark the start of a sub-agent operation.',
        AgentStartSchema.shape,
        async (input) => {
          emit('agent-start', input)
          return ok()
        },
      ),
      tool(
        'agent_complete',
        'Mark a sub-agent operation as complete.',
        AgentCompleteSchema.shape,
        async (input) => {
          emit('agent-complete', input)
          return ok()
        },
      ),
      tool(
        'gate_request',
        'Request a human spec+plan review gate. Suspends until resolved via REST. Pass a manifest of paths; the server reads the files from disk.',
        GateRequestSchema.shape,
        async (input) => {
          const { kind, payload } = input

          // Re-validate payload (input is already validated by SDK against the
          // top-level schema, but this is a belt-and-braces check that the
          // payload matches the spec+plan schema specifically).
          const parsed = SpecPlanGatePayloadSchema.safeParse(payload)
          if (!parsed.success) {
            throw new Error(
              `Invalid spec+plan payload: ${parsed.error.message}`,
            )
          }
          const manifest = parsed.data

          // Read all files (with traversal + size checks). Any failure throws
          // BEFORE we touch the DB or emit any events.
          const snapshot = await buildSpecPlanSnapshot(manifest)

          const gateId = crypto.randomUUID()

          db.prepare(`
            INSERT INTO gates (id, run_id, kind, payload, snapshot, status)
            VALUES (?, ?, ?, ?, ?, 'open')
          `).run(
            gateId,
            runId,
            kind,
            JSON.stringify(manifest),
            JSON.stringify(snapshot),
          )

          db.prepare("UPDATE runs SET status = 'paused-gate' WHERE id = ?").run(runId)

          const eventPayload: SpecPlanGateEventPayload = {
            ...manifest,
            snapshot,
          }

          emit('gate-request', {
            gate_id: gateId,
            gateKind: 'spec+plan' as const,
            gatePayload: eventPayload,
          })
          emit('status-change', { status: 'paused-gate' })

          const result = await createGateDeferred(runId, gateId)

          db.prepare(`
            UPDATE gates SET status='resolved', resolution=?, resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?
          `).run(JSON.stringify(result), gateId)

          db.prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(runId)

          emit('status-change', { status: 'running' })
          emit('gate-resolved', { gate_id: gateId, resolution: result })

          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
        },
      ),
      tool(
        'clarify_request',
        [
          'Ask the human clarifying questions before writing a spec. Suspends until the user submits answers or skips.',
          'Each question must be one focused ask. Use the structured fields — not a markdown blob in `text`:',
          '  • `group` — short section header shown as a chip (e.g. "Scope", "Timeline"). Omit if not useful.',
          '  • `text`  — the question as a single plain-text sentence ending with "?". No markdown, no asterisks, no backticks.',
          '  • `why`   — one sentence explaining why this matters (optional but recommended).',
          '  • `options` — provide when the answer space is bounded (e.g. Yes / No / Unknown).',
          'Example: { group: "Scope", text: "Should the service handle multi-tenant data?", why: "This determines whether we need row-level isolation.", options: [{ label: "Yes" }, { label: "No" }, { label: "Not sure yet" }] }',
        ].join('\n'),
        ClarifyRequestSchema.shape,
        async (input) => {
          const { questions } = input
          const gateId = crypto.randomUUID()

          db.prepare(`
            INSERT INTO gates (id, run_id, kind, payload, status)
            VALUES (?, ?, 'clarify', ?, 'open')
          `).run(gateId, runId, JSON.stringify({ questions }))

          db.prepare("UPDATE runs SET status = 'paused-gate' WHERE id = ?").run(runId)

          emit('gate-request', { gate_id: gateId, gateKind: 'clarify' as const, gatePayload: { questions } })
          emit('status-change', { status: 'paused-gate' })

          const result = await createGateDeferred(runId, gateId)

          db.prepare(`
            UPDATE gates SET status='resolved', resolution=?, resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?
          `).run(JSON.stringify(result), gateId)

          db.prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(runId)

          emit('status-change', { status: 'running' })
          emit('gate-resolved', { gate_id: gateId, resolution: result })

          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
        },
      ),
    ],
  })
}

// Helpers exported for tests / route reuse.
export { buildSpecPlanSnapshot, readGateFile, getMaxFileBytes }
