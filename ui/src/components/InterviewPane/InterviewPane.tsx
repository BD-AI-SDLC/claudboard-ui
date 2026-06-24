import './InterviewPane.css'
import { useEffect, useRef, type ReactNode } from 'react'
import type { ClarifyQuestion, ClarifyAnswer } from '@bosch-sdlc/protocol'
import { api } from '../../api/client.js'

export function renderInlineMarkdown(text: string): ReactNode {
  const nodes: ReactNode[] = []
  // Two-pass: first handle **bold**, then `code` within remaining segments.
  const boldRe = /\*\*(.+?)\*\*/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  const processCodeSpans = (raw: string, keyPrefix: string): ReactNode[] => {
    const codeRe = /`(.+?)`/g
    const parts: ReactNode[] = []
    let ci = 0
    let cm: RegExpExecArray | null
    while ((cm = codeRe.exec(raw)) !== null) {
      if (cm.index > ci) parts.push(raw.slice(ci, cm.index))
      parts.push(<code key={`${keyPrefix}-c${cm.index}`}>{cm[1]}</code>)
      ci = cm.index + cm[0].length
    }
    if (ci < raw.length) parts.push(raw.slice(ci))
    return parts
  }

  while ((match = boldRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(...processCodeSpans(text.slice(lastIndex, match.index), `pre-${match.index}`))
    }
    nodes.push(<strong key={`bold-${match.index}`}>{match[1]}</strong>)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    nodes.push(...processCodeSpans(text.slice(lastIndex), 'tail'))
  }

  return nodes.length === 1 ? nodes[0] : <>{nodes}</>
}

export interface NormalizedQuestion {
  text: string
  group?: string
  why?: string
  options?: Array<{ label: string; description?: string }>
}

export function normalize(q: string | ClarifyQuestion): NormalizedQuestion {
  if (typeof q === 'string') return { text: q }
  return q
}

interface InterviewPaneProps {
  runId: string
  gateId: string
  questions: Array<string | ClarifyQuestion>
  currentIndex: number
  answers: ClarifyAnswer[]
  onCurrentIndexChange: (index: number) => void
  onAnswersChange: (answers: ClarifyAnswer[]) => void
  onResolved?: () => void
}

export default function InterviewPane({
  runId,
  gateId,
  questions,
  currentIndex,
  answers,
  onCurrentIndexChange,
  onAnswersChange,
  onResolved,
}: InterviewPaneProps) {
  const normalized = questions.map(normalize)
  const resolvingRef = useRef(false)
  const threadRef = useRef<HTMLDivElement>(null)

  const isLast = currentIndex === normalized.length - 1
  const allPlainStrings = normalized.every((q) => !q.options)
  const q = normalized[currentIndex]
  const a = answers[currentIndex] ?? {}

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [currentIndex])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (isLast) void handleFinish()
        else handleNext()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const updateAnswer = (partial: Partial<ClarifyAnswer>) => {
    const next = [...answers]
    next[currentIndex] = { ...next[currentIndex], ...partial }
    onAnswersChange(next)
  }

  const handleNext = () => {
    if (currentIndex < normalized.length - 1) onCurrentIndexChange(currentIndex + 1)
  }

  const handlePrev = () => {
    if (currentIndex > 0) onCurrentIndexChange(currentIndex - 1)
  }

  const handleFinish = async () => {
    if (resolvingRef.current) return
    resolvingRef.current = true
    try {
      const resolution = allPlainStrings
        ? { answers: answers.map((a) => a.note ?? '') }
        : { answers }
      await api.resolveGate(runId, gateId, resolution)
      onResolved?.()
    } catch (err) {
      console.error(err)
    } finally {
      resolvingRef.current = false
    }
  }

  const handleSkip = async () => {
    if (resolvingRef.current) return
    resolvingRef.current = true
    try {
      await api.resolveGate(runId, gateId, { skipped: true })
      onResolved?.()
    } catch (err) {
      console.error(err)
    } finally {
      resolvingRef.current = false
    }
  }

  const getAnswerLabel = (qi: number): string => {
    const ans = answers[qi] ?? {}
    const nq = normalized[qi]
    if (ans.selected !== undefined && nq?.options) {
      return nq.options[ans.selected]?.label ?? ''
    }
    return ans.note?.trim() ? ans.note : '(no answer)'
  }

  if (!q) return null

  return (
    <div className="interview-pane__root">
      <div className="interview-pane__header">
        <span className="interview-pane__header-dot" />
        <span>Clarify scope · conversation · {currentIndex + 1} / {normalized.length}</span>
      </div>

      <div className="interview-pane__thread" ref={threadRef}>
        {normalized.slice(0, currentIndex).map((pq, i) => (
          <div key={i} className="interview-pane__bubble-row">
            <div className="interview-pane__bubble interview-pane__bubble--agent">
              {pq.group && <span className="interview-pane__group-chip">{pq.group}</span>}
              {renderInlineMarkdown(pq.text)}
            </div>
            <div
              className="interview-pane__bubble interview-pane__bubble--user"
              onClick={() => onCurrentIndexChange(i)}
              title="Click to edit"
            >
              {getAnswerLabel(i)}
            </div>
          </div>
        ))}

        <div className="interview-pane__active-card">
          {q.group && <span className="interview-pane__group-chip">{q.group}</span>}
          <div className="interview-pane__question-text">{renderInlineMarkdown(q.text)}</div>
          {q.why && <div className="interview-pane__why">{q.why}</div>}

          {q.options && (
            <div className="interview-pane__options" role="radiogroup">
              {q.options.map((opt, oi) => (
                <div
                  key={oi}
                  className={`interview-pane__option${a.selected === oi ? ' interview-pane__option--selected' : ''}`}
                  onClick={() => updateAnswer({ selected: oi })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') updateAnswer({ selected: oi })
                    if (e.key === 'Escape') updateAnswer({ selected: undefined })
                  }}
                  tabIndex={0}
                  role="radio"
                  aria-checked={a.selected === oi}
                >
                  <span className="interview-pane__option-radio" />
                  <span className="interview-pane__option-label">{opt.label}</span>
                  {opt.description && (
                    <span className="interview-pane__option-desc">{opt.description}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <textarea
            className="interview-pane__note-input"
            placeholder={q.options ? 'Optional note…' : 'Your answer…'}
            value={a.note ?? ''}
            onChange={(e) => updateAnswer({ note: e.target.value })}
            rows={2}
          />

          <div className="interview-pane__actions">
            <span className="interview-pane__kbd-hint">⌘ ↵ to submit</span>
            {currentIndex > 0 && (
              <button className="interview-pane__btn interview-pane__btn--ghost" onClick={handlePrev}>
                ← Previous
              </button>
            )}
            <button className="interview-pane__btn interview-pane__btn--ghost" onClick={() => void handleSkip()}>
              Skip all
            </button>
            <button
              className="interview-pane__btn interview-pane__btn--primary"
              onClick={isLast ? () => void handleFinish() : handleNext}
            >
              {isLast ? 'Finish interview →' : 'Next question →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
