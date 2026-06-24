import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import OperationCard from './OperationCard.js'
import type { PrereqRecord } from '@bosch-sdlc/protocol'
import type { VisualState } from './setup-utils.js'

function makePrereq(overrides: Partial<PrereqRecord> = {}): PrereqRecord {
  return {
    id: 'test',
    repoId: 'proj-1',
    cmd: 'analyse',
    state: 'done',
    lastRun: '2026-05-25T00:00:00Z',
    duration: 194000,
    cost: 42,
    output: null,
    staleReason: null,
    ...overrides,
  }
}

function renderCard(visualState: VisualState, overrides: Record<string, unknown> = {}) {
  return render(
    <OperationCard
      title="Analyse"
      cmd="/claudboard-analyse"
      desc="Read-only scan."
      visualState={visualState}
      stepNumber={1}
      prereq={makePrereq()}
      onRun={vi.fn()}
      onViewReport={vi.fn()}
      {...overrides}
    />
  )
}

afterEach(() => { cleanup() })

describe('OperationCard', () => {
  it('renders step number for foundation variant', () => {
    renderCard('done')
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('renders icon for maintenance variant', () => {
    render(
      <OperationCard
        title="Refresh"
        cmd="/claudboard-refresh"
        desc="Delta update."
        visualState="next"
        icon="↻"
        onRun={vi.fn()}
      />
    )
    expect(screen.getByText('↻')).toBeTruthy()
  })

  it('shows imported from disk badge when visualState is done-imported', () => {
    renderCard('done-imported', { prereq: makePrereq({ lastRun: null }) })
    expect(screen.getByText('imported from disk')).toBeTruthy()
  })

  it('shows Re-run button for done state', () => {
    renderCard('done')
    expect(screen.getByText('↻ Re-run')).toBeTruthy()
    expect(screen.getByText('View report')).toBeTruthy()
  })

  it('shows Run now button for next state', () => {
    renderCard('next')
    expect(screen.getByText('▶ Run now')).toBeTruthy()
  })

  it('shows Requires text for locked state', () => {
    renderCard('locked')
    expect(screen.getByText('Requires previous step')).toBeTruthy()
  })

  it('shows disabled Running button for running state', () => {
    renderCard('running')
    const btn = screen.getByText('Running…')
    expect(btn).toBeTruthy()
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows Refresh button for stale state', () => {
    renderCard('stale', { prereq: makePrereq({ state: 'stale' }) })
    expect(screen.getByText('Refresh')).toBeTruthy()
    expect(screen.getByText('Preview diff')).toBeTruthy()
  })

  it('calls onRun when Run now is clicked', () => {
    const onRun = vi.fn()
    renderCard('next', { onRun })
    fireEvent.click(screen.getByText('▶ Run now'))
    expect(onRun).toHaveBeenCalled()
  })

  it('calls onRun when Re-run is clicked', () => {
    const onRun = vi.fn()
    renderCard('done', { onRun })
    fireEvent.click(screen.getByText('↻ Re-run'))
    expect(onRun).toHaveBeenCalled()
  })

  describe('stale reason line', () => {
    it('renders "older than 7 days" for aged-out', () => {
      renderCard('stale', {
        prereq: makePrereq({ state: 'stale', staleReason: 'aged-out' }),
      })
      expect(screen.getByText('Stale — older than 7 days')).toBeTruthy()
    })

    it('renders "codebase changed since last run" for codebase-changed', () => {
      renderCard('stale', {
        prereq: makePrereq({ state: 'stale', staleReason: 'codebase-changed' }),
      })
      expect(screen.getByText('Stale — codebase changed since last run')).toBeTruthy()
    })

    it('does NOT render the reason line when staleReason is null (legacy row)', () => {
      renderCard('stale', { prereq: makePrereq({ state: 'stale', staleReason: null }) })
      expect(screen.queryByText(/Stale —/)).toBeNull()
    })

    it('does NOT render the reason line when visualState is not stale', () => {
      renderCard('done', { prereq: makePrereq({ state: 'done', staleReason: 'codebase-changed' }) })
      expect(screen.queryByText(/Stale —/)).toBeNull()
    })
  })

  describe('locked foundation card (setup complete)', () => {
    function renderLocked(titleOverride = 'Analyse') {
      return render(
        <OperationCard
          title={titleOverride}
          cmd="/claudboard-analyse"
          desc="Read-only scan."
          visualState="done"
          stepNumber={1}
          prereq={makePrereq({ state: 'done' })}
          locked={true}
          onRun={vi.fn()}
        />
      )
    }

    it('renders check mark and Setup complete for analyse', () => {
      renderLocked('Analyse')
      expect(screen.getByText('✓')).toBeTruthy()
      expect(screen.getByText('Setup complete')).toBeTruthy()
      expect(screen.getByText('Analyse')).toBeTruthy()
    })

    it('renders check mark and Setup complete for generate', () => {
      renderLocked('Generate')
      expect(screen.getByText('✓')).toBeTruthy()
      expect(screen.getByText('Setup complete')).toBeTruthy()
    })

    it('renders check mark and Setup complete for claudboard-workflow', () => {
      renderLocked('Feature-workflow')
      expect(screen.getByText('✓')).toBeTruthy()
      expect(screen.getByText('Setup complete')).toBeTruthy()
    })

    it('has aria-disabled=true', () => {
      const { container } = renderLocked()
      const card = container.querySelector('.op-card--locked-setup')
      expect(card?.getAttribute('aria-disabled')).toBe('true')
    })

    it('does not render Run or Re-run buttons', () => {
      renderLocked()
      expect(screen.queryByText('▶ Run now')).toBeNull()
      expect(screen.queryByText('↻ Re-run')).toBeNull()
    })
  })
})
