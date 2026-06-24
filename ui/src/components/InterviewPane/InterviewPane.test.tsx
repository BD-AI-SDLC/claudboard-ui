import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import InterviewPane, { renderInlineMarkdown } from './InterviewPane.js'
import ProgressRail from './ProgressRail.js'
import type { ClarifyAnswer } from '@bosch-sdlc/protocol'
import { ClarifyQuestionSchema } from '@bosch-sdlc/protocol'

vi.mock('../../api/client.js', () => ({
  api: {
    resolveGate: vi.fn().mockResolvedValue({}),
  },
}))

async function getApi() {
  const mod = await import('../../api/client.js')
  return mod.api
}

function renderInterview(overrides: {
  questions?: Array<string | { text: string; group?: string; why?: string; options?: Array<{ label: string; description?: string }> }>
  currentIndex?: number
  answers?: ClarifyAnswer[]
  onCurrentIndexChange?: (i: number) => void
  onAnswersChange?: (a: ClarifyAnswer[]) => void
  onResolved?: () => void
} = {}) {
  const {
    questions = ['What is the target workspace?'],
    currentIndex = 0,
    answers = questions.map(() => ({})),
    onCurrentIndexChange = vi.fn(),
    onAnswersChange = vi.fn(),
    onResolved = vi.fn(),
  } = overrides

  return render(
    <InterviewPane
      runId="run-1"
      gateId="gate-1"
      questions={questions}
      currentIndex={currentIndex}
      answers={answers}
      onCurrentIndexChange={onCurrentIndexChange}
      onAnswersChange={onAnswersChange}
      onResolved={onResolved}
    />
  )
}

describe('InterviewPane', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { cleanup() })

  it('renders plain string question as text-only card (no radio options)', () => {
    renderInterview({ questions: ['Which workspace are we targeting?'] })
    expect(screen.getByText('Which workspace are we targeting?')).toBeDefined()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.getByPlaceholderText('Your answer…')).toBeDefined()
  })

  it('shows "Finish interview →" on last question, "Next question →" otherwise', () => {
    renderInterview({
      questions: ['Q1?', 'Q2?', 'Q3?'],
      currentIndex: 0,
      answers: [{}, {}, {}],
    })
    expect(screen.getByText('Next question →')).toBeDefined()
    expect(screen.queryByText('Finish interview →')).toBeNull()
  })

  it('shows "Finish interview →" when on last question', () => {
    renderInterview({
      questions: ['Q1?', 'Q2?'],
      currentIndex: 1,
      answers: [{}, {}],
    })
    expect(screen.getByText('Finish interview →')).toBeDefined()
  })

  it('renders structured question with radio options', () => {
    renderInterview({
      questions: [
        {
          text: 'Which retry strategy?',
          options: [{ label: 'Fixed interval' }, { label: 'Exponential backoff' }],
        },
      ],
    })
    expect(screen.getByText('Which retry strategy?')).toBeDefined()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByText('Fixed interval')).toBeDefined()
    expect(screen.getByText('Exponential backoff')).toBeDefined()
  })

  it('renders "why" callout when provided', () => {
    renderInterview({
      questions: [{ text: 'Q?', why: 'Because of X constraint' }],
    })
    expect(screen.getByText('Because of X constraint')).toBeDefined()
  })

  it('selecting an option calls onAnswersChange with updated answer', () => {
    const onAnswersChange = vi.fn()
    renderInterview({
      questions: [{ text: 'Q?', options: [{ label: 'A' }, { label: 'B' }] }],
      onAnswersChange,
    })
    fireEvent.click(screen.getByText('A'))
    expect(onAnswersChange).toHaveBeenCalledWith([{ selected: 0 }])
  })

  it('typing in note calls onAnswersChange', () => {
    const onAnswersChange = vi.fn()
    renderInterview({ onAnswersChange })
    fireEvent.change(screen.getByPlaceholderText('Your answer…'), { target: { value: 'my answer' } })
    expect(onAnswersChange).toHaveBeenCalledWith([{ note: 'my answer' }])
  })

  it('"Next question →" calls onCurrentIndexChange with next index', () => {
    const onCurrentIndexChange = vi.fn()
    renderInterview({
      questions: ['Q1?', 'Q2?'],
      currentIndex: 0,
      answers: [{}, {}],
      onCurrentIndexChange,
    })
    fireEvent.click(screen.getByText('Next question →'))
    expect(onCurrentIndexChange).toHaveBeenCalledWith(1)
  })

  it('"← Previous" calls onCurrentIndexChange with previous index', () => {
    const onCurrentIndexChange = vi.fn()
    renderInterview({
      questions: ['Q1?', 'Q2?'],
      currentIndex: 1,
      answers: [{}, {}],
      onCurrentIndexChange,
    })
    fireEvent.click(screen.getByText('← Previous'))
    expect(onCurrentIndexChange).toHaveBeenCalledWith(0)
  })

  it('does not show "← Previous" on first question', () => {
    renderInterview({ questions: ['Q1?', 'Q2?'], currentIndex: 0, answers: [{}, {}] })
    expect(screen.queryByText('← Previous')).toBeNull()
  })

  it('clicking a previous answer bubble calls onCurrentIndexChange with that index', () => {
    const onCurrentIndexChange = vi.fn()
    renderInterview({
      questions: ['Q1?', 'Q2?'],
      currentIndex: 1,
      answers: [{ note: 'first answer' }, {}],
      onCurrentIndexChange,
    })
    expect(screen.getByText('first answer')).toBeDefined()
    fireEvent.click(screen.getByText('first answer'))
    expect(onCurrentIndexChange).toHaveBeenCalledWith(0)
  })

  it('"Finish interview →" on last question calls resolveGate with structured answers', async () => {
    const api = await getApi()
    renderInterview({
      questions: [{ text: 'Q?', options: [{ label: 'A' }] }],
      currentIndex: 0,
      answers: [{ selected: 0, note: 'looks good' }],
    })
    fireEvent.click(screen.getByText('Finish interview →'))
    await waitFor(() => {
      expect(api.resolveGate).toHaveBeenCalledWith('run-1', 'gate-1', {
        answers: [{ selected: 0, note: 'looks good' }],
      })
    })
  })

  it('"Finish interview →" with all plain strings sends answers as string array', async () => {
    const api = await getApi()
    renderInterview({
      questions: ['Q1?', 'Q2?'],
      currentIndex: 1,
      answers: [{ note: 'a1' }, { note: 'a2' }],
    })
    fireEvent.click(screen.getByText('Finish interview →'))
    await waitFor(() => {
      expect(api.resolveGate).toHaveBeenCalledWith('run-1', 'gate-1', { answers: ['a1', 'a2'] })
    })
  })

  it('"Skip all" calls resolveGate with skipped: true', async () => {
    const api = await getApi()
    renderInterview()
    fireEvent.click(screen.getByText('Skip all'))
    await waitFor(() => {
      expect(api.resolveGate).toHaveBeenCalledWith('run-1', 'gate-1', { skipped: true })
    })
  })
})

describe('renderInlineMarkdown', () => {
  afterEach(() => { cleanup() })

  function renderMd(text: string) {
    const { container } = render(<span>{renderInlineMarkdown(text)}</span>)
    return container.querySelector('span')!
  }

  it('renders **bold** as <strong>', () => {
    const el = renderMd('Hello **world**!')
    expect(el.querySelector('strong')?.textContent).toBe('world')
    expect(el.textContent).toBe('Hello world!')
  })

  it('renders `code` as <code>', () => {
    const el = renderMd('Use `npm install`')
    expect(el.querySelector('code')?.textContent).toBe('npm install')
    expect(el.textContent).toBe('Use npm install')
  })

  it('leaves plain text untouched', () => {
    const el = renderMd('Just plain text here.')
    expect(el.querySelector('strong')).toBeNull()
    expect(el.querySelector('code')).toBeNull()
    expect(el.textContent).toBe('Just plain text here.')
  })

  it('treats a lone single * as literal', () => {
    const el = renderMd('price is 5 * 2')
    expect(el.querySelector('strong')).toBeNull()
    expect(el.textContent).toBe('price is 5 * 2')
  })

  it('treats an unmatched ** as literal', () => {
    const el = renderMd('hello **world no close')
    expect(el.querySelector('strong')).toBeNull()
    expect(el.textContent).toBe('hello **world no close')
  })

  it('treats an unmatched ` as literal', () => {
    const el = renderMd('use `foo bar')
    expect(el.querySelector('code')).toBeNull()
    expect(el.textContent).toBe('use `foo bar')
  })

  it('renders mixed bold and code in order', () => {
    const el = renderMd('Use **bold** and `code` here.')
    expect(el.querySelector('strong')?.textContent).toBe('bold')
    expect(el.querySelector('code')?.textContent).toBe('code')
    expect(el.textContent).toBe('Use bold and code here.')
  })

  it('does not inject HTML from <script> strings', () => {
    const el = renderMd('<script>alert(1)</script>')
    expect(el.innerHTML).not.toContain('<script>')
    expect(el.textContent).toBe('<script>alert(1)</script>')
  })
})

describe('InterviewPane – renderInlineMarkdown integration', () => {
  afterEach(() => { cleanup() })

  it('active card question text uses renderInlineMarkdown (renders <strong> and <code>)', () => {
    render(
      <InterviewPane
        runId="run-1"
        gateId="gate-1"
        questions={[{ text: 'Is **bold** and `code` OK?' }]}
        currentIndex={0}
        answers={[{}]}
        onCurrentIndexChange={vi.fn()}
        onAnswersChange={vi.fn()}
        onResolved={vi.fn()}
      />
    )
    const questionDiv = document.querySelector('.interview-pane__question-text')
    expect(questionDiv?.querySelector('strong')?.textContent).toBe('bold')
    expect(questionDiv?.querySelector('code')?.textContent).toBe('code')
  })

  it('group chip does NOT use renderInlineMarkdown (renders ** literally)', () => {
    render(
      <InterviewPane
        runId="run-1"
        gateId="gate-1"
        questions={[{ text: 'Plain question?', group: '**notbold**' }]}
        currentIndex={0}
        answers={[{}]}
        onCurrentIndexChange={vi.fn()}
        onAnswersChange={vi.fn()}
        onResolved={vi.fn()}
      />
    )
    const chip = document.querySelector('.interview-pane__group-chip')
    expect(chip?.textContent).toBe('**notbold**')
    expect(chip?.querySelector('strong')).toBeNull()
  })
})

describe('ClarifyQuestionSchema field descriptions', () => {
  it('has non-empty description on every field of ClarifyQuestionSchema', () => {
    const fields = ClarifyQuestionSchema.shape
    expect(fields.text.description).toBeTruthy()
    expect(fields.group.description).toBeTruthy()
    expect(fields.why.description).toBeTruthy()
    expect(fields.options.description).toBeTruthy()
  })

  it('text description forbids markdown / plain-text-only', () => {
    const desc = ClarifyQuestionSchema.shape.text.description ?? ''
    const forbidsMarkdown = /markdown|plain|no formatting|no asterisk|no backtick/i.test(desc)
    expect(forbidsMarkdown).toBe(true)
  })
})

describe('ProgressRail', () => {
  afterEach(() => { cleanup() })

  it('shows numbered circles for pending questions, bullet for current', () => {
    render(
      <ProgressRail
        questions={[{ text: 'Q1?' }, { text: 'Q2?' }, { text: 'Q3?' }]}
        answers={[{}, {}, {}]}
        currentIndex={0}
        onNavigate={vi.fn()}
      />
    )
    // index 0 is current → shows ●; indices 1 and 2 are pending → show numbers 2, 3
    expect(screen.getByText('●')).toBeDefined()
    expect(screen.getByText('2')).toBeDefined()
    expect(screen.getByText('3')).toBeDefined()
  })

  it('shows checkmark for answered questions', () => {
    render(
      <ProgressRail
        questions={[{ text: 'Q1?' }, { text: 'Q2?' }]}
        answers={[{ note: 'answered' }, {}]}
        currentIndex={1}
        onNavigate={vi.fn()}
      />
    )
    expect(screen.getByText('✓')).toBeDefined()
  })

  it('shows bullet for current question', () => {
    render(
      <ProgressRail
        questions={[{ text: 'Q1?' }, { text: 'Q2?' }]}
        answers={[{}, {}]}
        currentIndex={1}
        onNavigate={vi.fn()}
      />
    )
    expect(screen.getByText('●')).toBeDefined()
  })

  it('clicking an entry fires onNavigate with correct index', () => {
    const onNavigate = vi.fn()
    render(
      <ProgressRail
        questions={[{ text: 'Question one' }, { text: 'Question two' }]}
        answers={[{}, {}]}
        currentIndex={0}
        onNavigate={onNavigate}
      />
    )
    fireEvent.click(screen.getByText('Question two'))
    expect(onNavigate).toHaveBeenCalledWith(1)
  })

  it('renders next steps section', () => {
    render(
      <ProgressRail
        questions={[{ text: 'Q?' }]}
        answers={[{}]}
        currentIndex={0}
        onNavigate={vi.fn()}
      />
    )
    expect(screen.getByText('Next steps')).toBeDefined()
    expect(screen.getByText(/patch Jira description/)).toBeDefined()
  })
})
