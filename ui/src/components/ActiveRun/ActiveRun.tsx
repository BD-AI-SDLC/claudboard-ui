// Visual parity: verify three-pane split (Pipeline / Stream / Telemetry) matches mock screen-run.jsx
import './ActiveRun.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { ClarifyAnswer, ClarifyQuestion, PhaseCost, Run, RunKind, SpecPlanGateEventPayload, WsEvent } from '@bosch-sdlc/protocol'
import { formatUsd } from '../../util/format.js'
import { api } from '../../api/client.js'
import { useRunStream } from '../../hooks/useRunStream.js'
import { buildStream } from './stream.js'
import { parseServerTime, formatStreamTime } from '../../lib/time.js'
import type { StreamEntry } from './stream.js'
import StatusChip from '../primitives/StatusChip.js'
import Meter from '../primitives/Meter.js'
import RunBanner from '../RunBanner/RunBanner.js'
import TopBar from '../primitives/TopBar.js'
import InterviewPane, { normalize } from '../InterviewPane/InterviewPane.js'
import ProgressRail from '../InterviewPane/ProgressRail.js'
import RunControlCluster from './RunControlCluster.js'

interface ActiveRunProps {
  runId: string
  onReviewGate?: (
    gateId: string,
    kind?: string,
    questions?: string[],
    specPlan?: SpecPlanGateEventPayload | null,
  ) => void
  /**
   * Called when the user clicks Restart in the topbar run-control cluster.
   * The app routes to the Kickoff page with `prefillRunId` set to this run's id.
   */
  onRestart?: (sourceRunId: string) => void
}

interface PhaseState {
  id: string
  num: number
  title: string
  status: 'pending' | 'active' | 'done' | 'gate' | 'failed'
  agents: AgentState[]
  startedAt?: number
  completedAt?: number
  currentCheckpoint?: string
}

interface AgentState {
  id: string
  name: string
  op: string
  status: 'pending' | 'active' | 'done' | 'failed'
  startedAt?: number
  completedAt?: number
}

const AGENT_MARKS: Record<string, string> = {
  main:             '•',
  'jira-agent':     'J',
  'sdd-expert':     'S',
  architect:        'A',
  implementation:   'I',
  'spec-reviewer':  'R',
  'design-reviewer':'D',
  'git-agent':      'G',
  'pr-agent':       'P',
  user:             'U',
}

function agentMark(name: string) {
  return AGENT_MARKS[name] ?? name.slice(0, 1).toUpperCase()
}

function elapsed(start?: number, end?: number): string {
  if (!start) return ''
  const s = Math.floor(((end ?? Date.now()) - start) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

const PHASE_TEMPLATE: Array<{ num: number; title: string }> = [
  { num: 1, title: 'Ticket · Clarify · Specify · Plan' },
  { num: 2, title: 'Create Branch' },
  { num: 3, title: 'Develop and Test' },
  { num: 4, title: 'Commit' },
  { num: 5, title: 'Review' },
  { num: 6, title: 'PR Creation' },
  { num: 7, title: 'Finalize JIRA' },
]

export function buildPipelineFromEvents(events: WsEvent[], runKind: RunKind | undefined = undefined): PhaseState[] {
  const phaseByNum = new Map<number, PhaseState>()
  if (runKind === undefined || runKind === 'feature') {
    for (const t of PHASE_TEMPLATE) {
      phaseByNum.set(t.num, {
        id: String(t.num),
        num: t.num,
        title: t.title,
        status: 'pending',
        agents: [],
      })
    }
  }

  let activeNum: number | null = null

  for (const ev of events) {
    if (ev.kind === 'phase-start') {
      const ph = phaseByNum.get(ev.payload.num) ?? {
        id: String(ev.payload.num),
        num: ev.payload.num,
        title: ev.payload.title,
        status: 'pending' as const,
        agents: [],
      }
      ph.title = ev.payload.title || ph.title
      ph.status = 'active'
      ph.startedAt = ph.startedAt ?? new Date(ev.t).getTime()
      phaseByNum.set(ev.payload.num, ph)
      activeNum = ev.payload.num
    } else if (ev.kind === 'phase-complete') {
      const ph = phaseByNum.get(ev.payload.num)
      if (ph) {
        ph.status = 'done'
        ph.completedAt = new Date(ev.t).getTime()
      }
      if (activeNum === ev.payload.num) activeNum = null
    } else if (ev.kind === 'checkpoint-start') {
      if (activeNum != null) {
        const ph = phaseByNum.get(activeNum)
        if (ph) ph.currentCheckpoint = ev.payload.title
      }
    } else if (ev.kind === 'checkpoint-complete') {
      if (activeNum != null) {
        const ph = phaseByNum.get(activeNum)
        if (ph) ph.currentCheckpoint = undefined
      }
    } else if (ev.kind === 'agent-start') {
      if (activeNum != null) {
        const ph = phaseByNum.get(activeNum)
        ph?.agents.push({
          id: ev.payload.name,
          name: ev.payload.name,
          op: ev.payload.op,
          status: 'active',
          startedAt: new Date(ev.t).getTime(),
        })
      }
    } else if (ev.kind === 'agent-complete') {
      for (const ph of phaseByNum.values()) {
        const agent = ph.agents.find((a) => a.name === ev.payload.name && a.status === 'active')
        if (agent) {
          agent.status = 'done'
          agent.completedAt = new Date(ev.t).getTime()
          break
        }
      }
    } else if (ev.kind === 'gate-request') {
      if (activeNum != null) {
        const ph = phaseByNum.get(activeNum)
        if (ph) ph.status = 'gate'
      }
    }
  }

  // Prepend synthetic main row for every phase that has started
  for (const ph of phaseByNum.values()) {
    if (ph.startedAt != null) {
      ph.agents.unshift({
        id: 'main',
        name: 'main',
        op: ph.currentCheckpoint ?? 'orchestrating',
        status: ph.status === 'done' ? 'done' : 'active',
        startedAt: ph.startedAt,
        completedAt: ph.completedAt,
      })
    }
  }

  return Array.from(phaseByNum.values()).sort((a, b) => a.num - b.num)
}


function renderEntry(entry: StreamEntry, i: number) {
  const depth = 'depth' in entry ? entry.depth : 0
  if (entry.kind === 'header') {
    return (
      <div key={i} className="active-run__ev active-run__ev--header">
        <span className="active-run__ev-time">—</span>
        <span className="active-run__ev-agent">ⓘ</span>
        <span className="active-run__ev-msg">session started · {entry.model} · {entry.tools} tools</span>
      </div>
    )
  }
  if (entry.kind === 'text') {
    return (
      <div key={i} className="active-run__ev active-run__ev--text" data-depth={depth}>
        <span className="active-run__ev-time">{entry.time ? formatStreamTime(entry.time) : '—'}</span>
        <span className="active-run__ev-agent">{entry.agent}</span>
        <div className="active-run__ev-msg active-run__ev-msg--md">
          <ReactMarkdown>{entry.text}</ReactMarkdown>
        </div>
      </div>
    )
  }
  if (entry.kind === 'thinking') {
    return (
      <div key={i} className="active-run__ev active-run__ev--thinking" data-depth={depth}>
        <span className="active-run__ev-time">{entry.time ? formatStreamTime(entry.time) : '—'}</span>
        <span className="active-run__ev-agent">{entry.agent}</span>
        <span className="active-run__ev-msg" style={{ whiteSpace: 'pre-wrap' }}>{entry.text}</span>
      </div>
    )
  }
  if (entry.kind === 'tool') {
    return (
      <div
        key={i}
        className={`active-run__ev active-run__ev--tool${entry.isError ? ' active-run__ev--error' : ''}`}
        data-depth={depth}
      >
        <span className="active-run__ev-time">{entry.time ? formatStreamTime(entry.time) : '—'}</span>
        <span className="active-run__ev-agent">{entry.agent}</span>
        <span className="active-run__ev-msg">
          <span>⏺ {entry.toolName}({entry.argSummary})</span>
          {entry.resultPreview != null && (
            <div className="active-run__ev-result">⎿ {entry.resultPreview}</div>
          )}
        </span>
      </div>
    )
  }
  if (entry.kind === 'footer') {
    return (
      <div key={i} className="active-run__ev active-run__ev--footer">
        <span className="active-run__ev-time">{entry.time ? formatStreamTime(entry.time) : '—'}</span>
        <span className="active-run__ev-agent">✓</span>
        <span className="active-run__ev-msg">
          run complete ({(entry.durationMs / 1000).toFixed(1)}s · ${entry.costUsd.toFixed(2)})
        </span>
      </div>
    )
  }
  return null
}

export default function ActiveRun({ runId, onReviewGate, onRestart }: ActiveRunProps) {
  const [run, setRun] = useState<Run | null>(null)
  const [selAgent, setSelAgent] = useState<string | null>(null)
  const [, tick] = useState(0)
  const [interviewCurrentIndex, setInterviewCurrentIndex] = useState(0)
  const [interviewAnswers, setInterviewAnswers] = useState<ClarifyAnswer[]>([])
  const streamRef = useRef<HTMLDivElement | null>(null)
  const { events, hydrated } = useRunStream(runId)

  const status = run?.status ?? 'running'
  const isTerminal = status === 'done' || status === 'failed'

  // Poll REST every 10s for telemetry
  useEffect(() => {
    api.getRun(runId).then(setRun).catch(console.error)
    const t = setInterval(() => {
      api.getRun(runId).then(setRun).catch(console.error)
    }, 10_000)
    return () => clearInterval(t)
  }, [runId])

  // Auto-scroll stream
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight
    }
  }, [events])

  // Tick once per second while run is non-terminal to unfreeze duration counters
  useEffect(() => {
    if (isTerminal) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [isTerminal])

  const phases = buildPipelineFromEvents(events, run?.kind)
  const streamEntries = buildStream(events)

  const { displayPhaseCosts, displayTotalCost, costFooter } = useMemo(() => {
    const eventMap = new Map<number, PhaseCost>()
    let eventTotal: number | null = null
    let eventFtr: { inputTokens: number; outputTokens: number; model: string } | null = null

    for (const ev of events) {
      if (ev.kind !== 'cost-update') continue
      if (ev.payload.scope === 'phase' && ev.payload.phaseNum != null) {
        eventMap.set(ev.payload.phaseNum, {
          phaseNum: ev.payload.phaseNum,
          phaseTitle: ev.payload.phaseTitle ?? '',
          costUsd: ev.payload.costUsd,
          inputTokens: ev.payload.inputTokens,
          outputTokens: ev.payload.outputTokens,
          cacheReadTokens: ev.payload.cacheReadTokens,
          apiCalls: ev.payload.apiCalls,
          model: ev.payload.model,
        })
      } else if (ev.payload.scope === 'total') {
        eventTotal = ev.payload.costUsd
        eventFtr = { inputTokens: ev.payload.inputTokens, outputTokens: ev.payload.outputTokens, model: ev.payload.model }
      }
    }

    const merged = new Map<number, PhaseCost>()
    for (const pc of (run?.phaseCosts ?? [])) merged.set(pc.phaseNum, pc)
    for (const [num, pc] of eventMap) merged.set(num, pc)

    const sorted = Array.from(merged.values()).sort((a, b) => a.phaseNum - b.phaseNum)
    const total = eventTotal ?? run?.costUsd ?? null
    const lastPhase = sorted.at(-1)
    const footer = eventFtr ?? (lastPhase ? { inputTokens: lastPhase.inputTokens, outputTokens: lastPhase.outputTokens, model: lastPhase.model } : null)
    return { displayPhaseCosts: sorted, displayTotalCost: total, costFooter: footer }
  }, [events, run])

  // Build the set of gate IDs that have already been resolved
  const resolvedGateIds = new Set(
    events
      .filter((ev) => ev.kind === 'gate-resolved')
      .map((ev) => (ev as { payload: { gate_id?: string } }).payload.gate_id)
      .filter(Boolean)
  )

  // Use the latest unresolved gate-request so multi-round clarification works correctly
  const gateEvent = [...events]
    .reverse()
    .find(
      (ev) =>
        ev.kind === 'gate-request' &&
        !resolvedGateIds.has((ev as { payload: { gate_id?: string } }).payload.gate_id)
    )
  const gateId = gateEvent
    ? (gateEvent as { payload: { gate_id?: string } }).payload.gate_id ?? null
    : null
  const gateKind = gateEvent
    ? (gateEvent as { payload: { gateKind?: string } }).payload.gateKind ?? undefined
    : undefined
  const gateQuestions: Array<string | ClarifyQuestion> = gateEvent && gateKind === 'clarify'
    ? ((gateEvent as { payload: { gatePayload?: { questions?: Array<string | ClarifyQuestion> } } }).payload.gatePayload?.questions ?? [])
    : []
  const gateSpecPlan = gateEvent && gateKind === 'spec+plan'
    ? ((gateEvent as { payload: { gatePayload?: SpecPlanGateEventPayload } }).payload.gatePayload ?? null)
    : null

  const isInterview = status === 'paused-gate' && gateKind === 'clarify'

  // Reset interview state when a new clarify gate opens
  useEffect(() => {
    if (isInterview && gateQuestions.length > 0) {
      setInterviewCurrentIndex(0)
      setInterviewAnswers(gateQuestions.map(() => ({})))
    }
  }, [gateId]) // intentionally depends only on gateId

  const normalizedQuestions = useMemo(
    () => gateQuestions.map(normalize),
    [gateId] // intentionally depends only on gateId
  )

  const answeredCount = interviewAnswers.filter(
    (a) => a.selected !== undefined || (a.note?.trim() ?? '') !== ''
  ).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <TopBar
        title={runId}
        breadcrumb={['runs', runId]}
        rightSlot={<RunControlCluster runId={runId} run={run} onRestart={onRestart} />}
      />

      {/* banner when gate paused */}
      <RunBanner
        status={status}
        gateId={gateId}
        gateKind={gateKind}
        questionCount={isInterview ? gateQuestions.length : undefined}
        answeredCount={isInterview ? answeredCount : undefined}
        onReview={() => gateId && onReviewGate?.(gateId, gateKind, gateQuestions as string[], gateSpecPlan)}
        onSkipInterview={
          isInterview && gateId
            ? () => api.resolveGate(runId, gateId, { skipped: true }).catch(console.error)
            : undefined
        }
      />

      <div className="active-run__split">
        {/* Pipeline pane */}
        <div className="active-run__pane active-run__pane--pipeline">
          <div className="active-run__pane-head">
            <h4>Pipeline</h4>
            <span className="active-run__pane-head-sub">
              {phases.length} phase{phases.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="active-run__pane-body">
            {!hydrated && (
              <div className="active-run__phase" data-status="pending">
                <div className="active-run__phase-head">
                  <span className="active-run__phase-title" style={{ color: 'var(--muted)' }}>Loading…</span>
                </div>
              </div>
            )}
            {hydrated && phases.length === 0 && run?.kind !== undefined && run.kind !== 'feature' && (
              <div className="active-run__phase active-run__phase--placeholder">
                CLI run · see stream →
              </div>
            )}
            {hydrated && phases.map((ph) => (
              <div key={ph.id} className="active-run__phase" data-status={ph.status}>
                <div className="active-run__phase-head">
                  <span className="active-run__phase-num">{ph.num}</span>
                  <span className="active-run__phase-title">{ph.title}</span>
                  <span className="active-run__phase-dur">{elapsed(ph.startedAt, ph.completedAt)}</span>
                </div>
                {(ph.status === 'active' || ph.status === 'gate') && (
                <div className="active-run__agents">
                  {ph.agents.map((a) => (
                    <div
                      key={a.id}
                      className={`active-run__agent${selAgent === a.id ? ' active-run__agent--sel' : ''}`}
                      data-status={a.status}
                      onClick={() => setSelAgent(a.id)}
                    >
                      <span className="active-run__agent-mark">{agentMark(a.name)}</span>
                      <span className="active-run__agent-name">
                        <b>{a.name}</b> {a.op && <em>· {a.op}</em>}
                      </span>
                      {a.status === 'active' && <span className="active-run__pulse-dot" />}
                      <span className="active-run__agent-dur">{elapsed(a.startedAt, a.completedAt)}</span>
                    </div>
                  ))}
                </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Stream pane — hidden during interview, replaced by InterviewPane */}
        <div className="active-run__pane active-run__pane--stream">
          {!isInterview && (
            <div className="active-run__pane-head">
              <h4>Live stream</h4>
              <span className="active-run__pane-head-sub">{events.length} events</span>
            </div>
          )}
          <div className="active-run__stream" ref={streamRef} style={isInterview ? { display: 'none' } : {}}>
            {streamEntries.map((entry, i) => renderEntry(entry, i))}
            {status === 'paused-gate' && (
              <>
                <div className="active-run__stream-sep">waiting for human input</div>
                <div className="active-run__ev active-run__ev--gate">
                  <span className="active-run__ev-time">—</span>
                  <span className="active-run__ev-agent">user</span>
                  <span className="active-run__ev-msg">
                    <span className="active-run__pulse-dot" style={{ display: 'inline-block', marginRight: '6px', verticalAlign: 'middle' }} />
                    {gateKind === 'clarify' ? 'answer clarification questions' : 'review spec + plan to continue'}
                  </span>
                </div>
              </>
            )}
          </div>
          {isInterview && gateId && (
            <InterviewPane
              key={gateId}
              runId={runId}
              gateId={gateId}
              questions={gateQuestions}
              currentIndex={interviewCurrentIndex}
              answers={interviewAnswers}
              onCurrentIndexChange={setInterviewCurrentIndex}
              onAnswersChange={setInterviewAnswers}
            />
          )}
        </div>

        {/* Telemetry pane — shows ProgressRail during interview */}
        <div className="active-run__pane active-run__pane--telemetry">
          {isInterview ? (
            <ProgressRail
              questions={normalizedQuestions}
              answers={interviewAnswers}
              currentIndex={interviewCurrentIndex}
              onNavigate={setInterviewCurrentIndex}
            />
          ) : (
            <>
              <div className="active-run__pane-head">
                <h4>Run telemetry</h4>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <div className="active-run__rail-section">
                  <div className="active-run__rail-h">Status</div>
                  <div style={{ marginBottom: '10px' }}>
                    <StatusChip status={status} />
                  </div>
                  <Meter
                    value={phases.filter((p) => p.status === 'done').length / Math.max(1, phases.length)}
                    color={status === 'paused-gate' ? 'amber' : undefined}
                  />
                  <div className="active-run__kv">
                    <span className="active-run__kv-key">Phase</span>
                    <span className="active-run__kv-val">{phases.filter((p) => p.status === 'done').length} / {phases.length}</span>
                  </div>
                  <div className="active-run__kv">
                    <span className="active-run__kv-key">Run ID</span>
                    <span className="active-run__kv-val active-run__kv-val--mono">{runId}</span>
                  </div>
                </div>

                {run && (
                  <div className="active-run__rail-section">
                    <div className="active-run__rail-h">Run info</div>
                    <div className="active-run__kv">
                      <span className="active-run__kv-key">Project</span>
                      <span className="active-run__kv-val active-run__kv-val--mono">{run.repoId}</span>
                    </div>
                    <div className="active-run__kv">
                      <span className="active-run__kv-key">Autonomy</span>
                      <span className="active-run__kv-val active-run__kv-val--mono">{run.autonomy}</span>
                    </div>
                    <div className="active-run__kv">
                      <span className="active-run__kv-key">Started</span>
                      <span className="active-run__kv-val active-run__kv-val--mono">
                        {(() => { const d = parseServerTime(run.createdAt); return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString() })()}
                      </span>
                    </div>
                  </div>
                )}

                <div className="active-run__rail-section">
                  <div className="active-run__rail-h">Events</div>
                  <div className="active-run__kv">
                    <span className="active-run__kv-key">Total</span>
                    <span className="active-run__kv-val active-run__kv-val--mono">{events.length}</span>
                  </div>
                </div>

                {(displayTotalCost !== null || displayPhaseCosts.length > 0) && (
                  <div className="active-run__rail-section">
                    <div className="active-run__rail-h">Cost</div>
                    <div className="active-run__kv active-run__kv--cost">
                      <span className="active-run__kv-key">Total</span>
                      <span className="active-run__kv-val active-run__kv-val--mono active-run__kv-val--cost">
                        {displayTotalCost !== null ? formatUsd(displayTotalCost) : '—'}
                      </span>
                    </div>
                    {displayPhaseCosts.map((pc) => (
                      <div key={pc.phaseNum} className="active-run__kv active-run__kv--cost">
                        <span className="active-run__kv-key active-run__kv-key--phase">
                          {pc.phaseNum} · {pc.phaseTitle}
                        </span>
                        <span className="active-run__kv-val active-run__kv-val--mono active-run__kv-val--cost">
                          {formatUsd(pc.costUsd)}
                        </span>
                      </div>
                    ))}
                    {costFooter && (
                      <>
                        <div className="active-run__kv">
                          <span className="active-run__kv-key">Tokens</span>
                          <span className="active-run__kv-val active-run__kv-val--mono active-run__kv-val--xs">
                            {costFooter.inputTokens.toLocaleString()} in · {costFooter.outputTokens.toLocaleString()} out
                          </span>
                        </div>
                        <div className="active-run__kv">
                          <span className="active-run__kv-key">Model</span>
                          <span className="active-run__kv-val active-run__kv-val--mono active-run__kv-val--xs">{costFooter.model}</span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
