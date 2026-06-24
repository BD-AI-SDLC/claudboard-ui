import type { ClarifyAnswer } from '@bosch-sdlc/protocol'
import type { NormalizedQuestion } from './InterviewPane.js'

interface ProgressRailProps {
  questions: NormalizedQuestion[]
  answers: ClarifyAnswer[]
  currentIndex: number
  onNavigate: (index: number) => void
}

function isAnswered(a: ClarifyAnswer): boolean {
  return a.selected !== undefined || (a.note !== undefined && a.note.trim() !== '')
}

export default function ProgressRail({ questions, answers, currentIndex, onNavigate }: ProgressRailProps) {
  return (
    <div className="interview-rail__root">
      <div className="interview-rail__title">Interview progress</div>
      <div className="interview-rail__list">
        {questions.map((q, i) => {
          const answered = isAnswered(answers[i] ?? {})
          const isCurrent = i === currentIndex
          return (
            <div
              key={i}
              className={`interview-rail__entry${isCurrent ? ' interview-rail__entry--current' : ''}${answered ? ' interview-rail__entry--answered' : ''}`}
              onClick={() => onNavigate(i)}
            >
              <span className="interview-rail__circle">
                {answered ? '✓' : isCurrent ? '●' : String(i + 1)}
              </span>
              <div className="interview-rail__entry-body">
                {q.group && <div className="interview-rail__group">{q.group}</div>}
                <div className="interview-rail__text">
                  {q.text.length > 60 ? q.text.slice(0, 60) + '…' : q.text}
                </div>
                {answered && answers[i] && (
                  <div className="interview-rail__answer">
                    {answers[i]!.selected !== undefined && q.options
                      ? q.options[answers[i]!.selected!]?.label
                      : answers[i]!.note}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="interview-rail__next-steps">
        <div className="interview-rail__next-steps-title">Next steps</div>
        <div className="interview-rail__next-steps-body">
          patch Jira description → hand off to sdd-expert → architect-agent → human gate at phase 1d
        </div>
      </div>
    </div>
  )
}
