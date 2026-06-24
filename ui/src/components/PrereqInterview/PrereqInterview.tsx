import './PrereqInterview.css'
import { useEffect, useMemo, useState } from 'react'
import type { InteractiveQuestion, WsEvent } from '@bosch-sdlc/protocol'
import { api } from '../../api/client.js'
import { useRunStream } from '../../hooks/useRunStream.js'

interface PrereqInterviewProps {
  runId: string
  cmd: string
}

interface HistoryEntry {
  toolUseId: string
  questions: InteractiveQuestion[]
  /** When the event was received in the run's WS stream. */
  timestamp: string
  /** One answer per question (single-question is the overwhelming common case;
   *  we still support compound AskUserQuestion shapes by indexing). */
  selections: Array<{ optionIndex: number | null; note: string }>
  status: 'pending' | 'submitted' | 'skipped'
  /** Server-side error to surface on the card after a failed POST. */
  error?: string
}

function isInteractiveEvent(
  ev: WsEvent,
): ev is Extract<WsEvent, { kind: 'interactive-question' }> {
  return ev.kind === 'interactive-question'
}

function shortTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

function summarizeAnswer(entry: HistoryEntry): string {
  if (entry.status === 'skipped') return '(skipped)'
  const labels: string[] = []
  for (let qi = 0; qi < entry.questions.length; qi++) {
    const q = entry.questions[qi]!
    const sel = entry.selections[qi]
    if (!sel) continue
    if (sel.optionIndex !== null) {
      labels.push(q.options[sel.optionIndex]?.label ?? '')
    } else if (sel.note.trim()) {
      labels.push(sel.note.trim())
    }
  }
  return labels.filter(Boolean).join(' · ') || '(no answer)'
}

export default function PrereqInterview({ runId, cmd }: PrereqInterviewProps) {
  const { events } = useRunStream(runId)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [submittingToolUseId, setSubmittingToolUseId] = useState<string | null>(null)

  // Build (or merge) history entries from the event stream. We dedupe by
  // toolUseId so re-renders triggered by other event kinds don't duplicate.
  useEffect(() => {
    setHistory((prev) => {
      const byId = new Map(prev.map((e) => [e.toolUseId, e]))
      let changed = false
      for (const ev of events) {
        if (!isInteractiveEvent(ev)) continue
        const { toolUseId, questions } = ev.payload
        if (byId.has(toolUseId)) continue
        byId.set(toolUseId, {
          toolUseId,
          questions,
          timestamp: ev.t,
          selections: questions.map(() => ({ optionIndex: null, note: '' })),
          status: 'pending',
        })
        changed = true
      }
      if (!changed) return prev
      // Preserve insertion order by re-collecting from the merged map.
      return Array.from(byId.values())
    })
  }, [events])

  const pending = history.find((e) => e.status === 'pending') ?? null
  const submittedCount = history.filter((e) => e.status !== 'pending').length
  const total = history.length

  const updateSelection = (toolUseId: string, qi: number, partial: Partial<HistoryEntry['selections'][number]>) => {
    setHistory((prev) =>
      prev.map((e) => {
        if (e.toolUseId !== toolUseId) return e
        const next = [...e.selections]
        next[qi] = { ...next[qi]!, ...partial }
        return { ...e, selections: next }
      }),
    )
  }

  const buildAnswers = (entry: HistoryEntry): Array<{ answer: string }> => {
    return entry.questions.map((q, qi) => {
      const sel = entry.selections[qi]
      if (!sel) return { answer: '' }
      if (sel.optionIndex !== null) return { answer: q.options[sel.optionIndex]?.label ?? '' }
      return { answer: sel.note.trim() }
    })
  }

  const handleSubmit = async (entry: HistoryEntry) => {
    setSubmittingToolUseId(entry.toolUseId)
    try {
      const answers = buildAnswers(entry)
      await api.submitCliAnswer(runId, { toolUseId: entry.toolUseId, answers })
      setHistory((prev) =>
        prev.map((e) =>
          e.toolUseId === entry.toolUseId
            ? { ...e, status: 'submitted', error: undefined }
            : e,
        ),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit answer'
      setHistory((prev) =>
        prev.map((e) => (e.toolUseId === entry.toolUseId ? { ...e, error: message } : e)),
      )
    } finally {
      setSubmittingToolUseId(null)
    }
  }

  const handleSkip = async (entry: HistoryEntry) => {
    setSubmittingToolUseId(entry.toolUseId)
    try {
      await api.submitCliAnswer(runId, { toolUseId: entry.toolUseId, answers: [] })
      setHistory((prev) =>
        prev.map((e) =>
          e.toolUseId === entry.toolUseId
            ? { ...e, status: 'skipped', error: undefined }
            : e,
        ),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to skip'
      setHistory((prev) =>
        prev.map((e) => (e.toolUseId === entry.toolUseId ? { ...e, error: message } : e)),
      )
    } finally {
      setSubmittingToolUseId(null)
    }
  }

  const headerSummary = useMemo(() => {
    if (total === 0) return null
    const currentNum = submittedCount + (pending ? 1 : 0)
    return `question ${currentNum} of ${total}`
  }, [submittedCount, pending, total])

  if (history.length === 0) return null

  return (
    <div className="prereq-interview">
      <div className="prereq-interview__head">
        <span className="prereq-interview__dot" />
        <span className="prereq-interview__title">Interview · {cmd}</span>
        {headerSummary && <span className="prereq-interview__count">{headerSummary}</span>}
      </div>

      <div className="prereq-interview__stream">
        {history.map((entry, idx) => {
          if (entry.status !== 'pending') {
            return (
              <div key={entry.toolUseId} className="prereq-interview__card prereq-interview__card--done">
                <span className="prereq-interview__time">{shortTime(entry.timestamp)}</span>
                <div className="prereq-interview__qline">
                  <span className="prereq-interview__qmark">?</span>
                  <span className="prereq-interview__qtext">{entry.questions[0]?.question ?? ''}</span>
                  <span className="prereq-interview__answer">→ ✓ {summarizeAnswer(entry)}</span>
                </div>
                <button
                  type="button"
                  className="prereq-interview__edit"
                  title="Edit answers (coming soon)"
                  disabled
                >
                  edit
                </button>
              </div>
            )
          }

          // Pending — expanded card. v1 supports a single question per
          // AskUserQuestion event for the UI; if a skill ever asks compound
          // questions we render the first one and silently submit all selections.
          const q = entry.questions[0]
          if (!q) return null
          const sel = entry.selections[0]!
          const cardNum = idx + 1
          const isSubmitting = submittingToolUseId === entry.toolUseId

          return (
            <div
              key={entry.toolUseId}
              className="prereq-interview__card prereq-interview__card--current"
            >
              <div className="prereq-interview__card-head">
                <div className="prereq-interview__badge">?</div>
                <span className="prereq-interview__group">
                  question {cardNum}{q.header ? ` · ${q.header}` : ''}
                </span>
                <span className="prereq-interview__time prereq-interview__time--right">
                  {shortTime(entry.timestamp)}
                </span>
              </div>
              <div className="prereq-interview__qbig">{q.question}</div>

              <div className="prereq-interview__options" role="radiogroup">
                {q.options.map((opt, oi) => (
                  <button
                    key={oi}
                    type="button"
                    className={`prereq-interview__opt${sel.optionIndex === oi ? ' prereq-interview__opt--on' : ''}`}
                    onClick={() => updateSelection(entry.toolUseId, 0, { optionIndex: oi })}
                    role="radio"
                    aria-checked={sel.optionIndex === oi}
                  >
                    <span className="prereq-interview__rad" />
                    <span className="prereq-interview__opt-text">
                      <span className="prereq-interview__opt-label">{opt.label}</span>
                      {opt.description && (
                        <span className="prereq-interview__opt-desc">{opt.description}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>

              <div className="prereq-interview__actions">
                <input
                  type="text"
                  className="prereq-interview__note"
                  placeholder="optional note…"
                  value={sel.note}
                  onChange={(e) => updateSelection(entry.toolUseId, 0, { note: e.target.value })}
                />
                <button
                  type="button"
                  className="prereq-interview__btn prereq-interview__btn--ghost"
                  onClick={() => void handleSkip(entry)}
                  disabled={isSubmitting}
                >
                  Skip
                </button>
                <button
                  type="button"
                  className="prereq-interview__btn prereq-interview__btn--primary"
                  onClick={() => void handleSubmit(entry)}
                  disabled={isSubmitting || (sel.optionIndex === null && sel.note.trim() === '')}
                >
                  {isSubmitting ? 'Submitting…' : 'Submit'}
                </button>
              </div>

              {entry.error && (
                <div className="prereq-interview__error" role="alert">
                  {entry.error}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
