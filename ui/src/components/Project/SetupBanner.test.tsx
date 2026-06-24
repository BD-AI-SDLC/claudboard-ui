import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import SetupBanner from './SetupBanner.js'
import type { PrereqRecord } from '@bosch-sdlc/protocol'

function makePrereq(cmd: string, state: 'done' | 'stale' | 'missing' = 'done'): PrereqRecord {
  return {
    id: cmd,
    repoId: 'proj-1',
    cmd: cmd as PrereqRecord['cmd'],
    state,
    lastRun: state === 'done' ? '2026-05-25T00:00:00Z' : null,
    duration: 194000,
    cost: 42,
    output: null,
    staleReason: null,
  }
}

afterEach(() => { cleanup() })

describe('SetupBanner', () => {
  it('renders expanded state when not all foundation ops are done', () => {
    const prereqs = {
      analyse: makePrereq('analyse', 'done'),
      generate: makePrereq('generate', 'done'),
    }
    render(<SetupBanner prereqs={prereqs} running={{}} onRunNext={vi.fn()} />)
    expect(screen.getByText('Set up Claudboard for this repo')).toBeTruthy()
    expect(screen.getByText('2 of 3 done')).toBeTruthy()
  })

  it('shows correct progress count', () => {
    const prereqs = {
      analyse: makePrereq('analyse', 'done'),
    }
    render(<SetupBanner prereqs={prereqs} running={{}} onRunNext={vi.fn()} />)
    expect(screen.getByText('1 of 3 done')).toBeTruthy()
  })

  it('CTA button label includes the next step command', () => {
    const prereqs = {
      analyse: makePrereq('analyse', 'done'),
      generate: makePrereq('generate', 'done'),
    }
    render(<SetupBanner prereqs={prereqs} running={{}} onRunNext={vi.fn()} />)
    expect(screen.getByText('▶ Run /claudboard-workflow')).toBeTruthy()
  })

  it('clicking CTA calls onRunNext with the correct command', () => {
    const onRunNext = vi.fn()
    const prereqs = {
      analyse: makePrereq('analyse', 'done'),
      generate: makePrereq('generate', 'done'),
    }
    render(<SetupBanner prereqs={prereqs} running={{}} onRunNext={onRunNext} />)
    fireEvent.click(screen.getByText('▶ Run /claudboard-workflow'))
    expect(onRunNext).toHaveBeenCalledWith('workflow')
  })

  it('renders nothing when all 3 foundation ops are done (operational mode)', () => {
    const prereqs = {
      analyse: makePrereq('analyse', 'done'),
      generate: makePrereq('generate', 'done'),
      'workflow': makePrereq('workflow', 'done'),
    }
    const { container } = render(<SetupBanner prereqs={prereqs} running={{}} onRunNext={vi.fn()} />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText('Set up Claudboard for this repo')).toBeNull()
    expect(screen.queryByText(/Setup complete/)).toBeNull()
  })

  it('renders the setup banner when some ops are stale (not operational — only done counts)', () => {
    const prereqs = {
      analyse: makePrereq('analyse', 'done'),
      generate: makePrereq('generate', 'stale'),
      'workflow': makePrereq('workflow', 'stale'),
    }
    const { container } = render(<SetupBanner prereqs={prereqs} running={{}} onRunNext={vi.fn()} />)
    expect(container.firstChild).not.toBeNull()
    expect(screen.getByText('Set up Claudboard for this repo')).toBeTruthy()
  })

  it('renders the setup banner when all foundation ops are stale (not operational)', () => {
    const prereqs = {
      analyse: makePrereq('analyse', 'stale'),
      generate: makePrereq('generate', 'stale'),
      'workflow': makePrereq('workflow', 'stale'),
    }
    const { container } = render(<SetupBanner prereqs={prereqs} running={{}} onRunNext={vi.fn()} />)
    expect(container.firstChild).not.toBeNull()
  })

  it('renders the full banner when at least one op is missing — even if another is stale', () => {
    const prereqs = {
      analyse: makePrereq('analyse', 'stale'),
      generate: makePrereq('generate', 'done'),
      'workflow': makePrereq('workflow', 'missing'),
    }
    render(<SetupBanner prereqs={prereqs} running={{}} onRunNext={vi.fn()} />)
    expect(screen.getByText('Set up Claudboard for this repo')).toBeTruthy()
  })

  it('shows first step as next when nothing is done', () => {
    render(<SetupBanner prereqs={{}} running={{}} onRunNext={vi.fn()} />)
    expect(screen.getByText('▶ Run /claudboard-analyse')).toBeTruthy()
    expect(screen.getByText('0 of 3 done')).toBeTruthy()
  })
})
