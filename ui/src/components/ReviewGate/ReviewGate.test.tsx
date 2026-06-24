import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import ReviewGate from './ReviewGate.js'
import type { GateFileSnapshot } from '@bosch-sdlc/protocol'

vi.mock('../../api/client.js', () => ({
  api: {
    resolveGate: vi.fn().mockResolvedValue({}),
  },
}))

vi.mock('../primitives/Icon.js', () => ({
  default: ({ name }: { name: string }) => <span data-icon={name} />,
}))

vi.mock('../primitives/TopBar.js', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}))

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}))

const workspaceRoot = '/repo'

function snap(path: string, content: string): GateFileSnapshot {
  return {
    path,
    content,
    size: content.length,
    mtime: '2026-05-21T10:00:00.000Z',
  }
}

describe('ReviewGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  // --- Tab model ---

  it('first spec is the default active tab', () => {
    render(
      <ReviewGate
        runId="r1"
        gateId="g1"
        workspaceRoot={workspaceRoot}
        specFiles={[
          snap('/repo/spec/auth.feature', 'Feature: Auth\n'),
          snap('/repo/spec/profile.feature', 'Feature: Profile\n'),
        ]}
        plan={snap('/repo/PLAN.md', '# Plan')}
      />
    )
    // Gherkin content visible, not markdown
    expect(screen.getByText(/Feature: Auth/)).toBeDefined()
    expect(screen.queryByTestId('markdown')).toBeNull()
  })

  it('renders one tab per spec file plus the plan tab', () => {
    render(
      <ReviewGate
        runId="r1"
        gateId="g1"
        workspaceRoot={workspaceRoot}
        specFiles={[
          snap('/repo/spec/auth.feature', 'Feature: Auth\n'),
          snap('/repo/spec/profile.feature', 'Feature: Profile\n'),
        ]}
        plan={snap('/repo/PLAN.md', '# Plan')}
      />
    )
    expect(screen.getByRole('button', { name: 'auth.feature' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'profile.feature' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'PLAN.md' })).toBeDefined()
  })

  it('plan tab is appended after all spec tabs', () => {
    render(
      <ReviewGate
        runId="r1"
        gateId="g1"
        workspaceRoot={workspaceRoot}
        specFiles={[
          snap('/repo/spec/a.feature', 'Feature: A\n'),
          snap('/repo/spec/b.feature', 'Feature: B\n'),
        ]}
        plan={snap('/repo/PLAN.md', '# Plan')}
      />
    )
    const buttons = screen.getAllByRole('button')
    const tabLabels = buttons.map((b) => b.textContent?.trim()).filter(Boolean)
    const aIdx = tabLabels.findIndex((l) => l === 'a.feature')
    const bIdx = tabLabels.findIndex((l) => l === 'b.feature')
    const planIdx = tabLabels.findIndex((l) => l === 'PLAN.md')
    expect(aIdx).toBeLessThan(planIdx)
    expect(bIdx).toBeLessThan(planIdx)
  })

  it('switches to plan renderer when plan tab is clicked', () => {
    render(
      <ReviewGate
        runId="r1"
        gateId="g1"
        workspaceRoot={workspaceRoot}
        specFiles={[snap('/repo/spec/auth.feature', 'Feature: Auth\n')]}
        plan={snap('/repo/PLAN.md', '# Execution Plan\n\n1. Step one')}
      />
    )
    // Plan tab not visible initially
    expect(screen.queryByTestId('markdown')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'PLAN.md' }))

    const md = screen.getByTestId('markdown')
    expect(md.textContent).toContain('Execution Plan')
    expect(md.textContent).toContain('Step one')
  })

  it('switches active spec tab when clicking another file', () => {
    render(
      <ReviewGate
        runId="r1"
        gateId="g1"
        workspaceRoot={workspaceRoot}
        specFiles={[
          snap('/repo/spec/auth.feature', 'Feature: Auth\n'),
          snap('/repo/spec/profile.feature', 'Feature: Profile UI\n'),
        ]}
        plan={snap('/repo/PLAN.md', '# Plan')}
      />
    )
    expect(screen.getByText(/Feature: Auth/)).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'profile.feature' }))

    expect(screen.getByText(/Feature: Profile UI/)).toBeDefined()
  })

  it('renders SPECS: and PLAN: group labels when both are present', () => {
    render(
      <ReviewGate
        runId="r1"
        gateId="g1"
        workspaceRoot={workspaceRoot}
        specFiles={[snap('/repo/spec/a.feature', 'Feature: A\n')]}
        plan={snap('/repo/PLAN.md', '# Plan')}
      />
    )
    expect(screen.getByText('SPECS:')).toBeDefined()
    expect(screen.getByText('PLAN:')).toBeDefined()
  })

  it('plan-only payload: plan is default active, no SPECS label or divider', () => {
    render(
      <ReviewGate
        runId="r1"
        gateId="g1"
        workspaceRoot={workspaceRoot}
        specFiles={[]}
        plan={snap('/repo/PLAN.md', '# Execution Plan')}
      />
    )
    // Plan renders as markdown immediately
    expect(screen.getByTestId('markdown')).toBeDefined()
    // No SPECS group label
    expect(screen.queryByText('SPECS:')).toBeNull()
    // No spec tab buttons — only the PLAN tab
    expect(screen.getByRole('button', { name: 'PLAN.md' })).toBeDefined()
  })

  it('renders empty state when both specFiles and plan are absent', () => {
    render(
      <ReviewGate
        runId="r1"
        gateId="g1"
        workspaceRoot={workspaceRoot}
        specFiles={[]}
        plan={null}
      />
    )
    expect(screen.getByText('No files in this gate.')).toBeDefined()
  })

  // --- Drift ---

  it('shows the drift banner after Refresh reports drifted:true', async () => {
    const liveResponse = {
      path: '/repo/spec/auth.feature',
      content: 'Feature: Auth (edited)\n',
      size: 24,
      mtime: '2026-05-21T11:00:00.000Z',
      drifted: true,
      snapshotMtime: '2026-05-21T10:00:00.000Z',
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => liveResponse,
      text: async () => '',
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ReviewGate
        runId="r1"
        gateId="g1"
        workspaceRoot={workspaceRoot}
        specFiles={[snap('/repo/spec/auth.feature', 'Feature: Auth\n')]}
        plan={snap('/repo/PLAN.md', '# Plan')}
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: /Refresh/ })[0]!)

    await waitFor(() => {
      expect(screen.getByText(/Showing current/)).toBeDefined()
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/gates/g1/files/0')
  })

  it('shows drift dot on inactive spec tab after refresh reports drifted:true', async () => {
    const liveFor1 = {
      path: '/repo/spec/b.feature',
      content: 'Feature: B (edited)\n',
      size: 20,
      mtime: '2026-05-21T11:00:00.000Z',
      drifted: true,
      snapshotMtime: '2026-05-21T10:00:00.000Z',
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => liveFor1,
      text: async () => '',
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ReviewGate
        runId="r1"
        gateId="g1"
        workspaceRoot={workspaceRoot}
        specFiles={[
          snap('/repo/spec/a.feature', 'Feature: A\n'),
          snap('/repo/spec/b.feature', 'Feature: B\n'),
        ]}
        plan={snap('/repo/PLAN.md', '# Plan')}
      />
    )

    // Switch to b.feature, refresh it, then switch back to a.feature
    fireEvent.click(screen.getByRole('button', { name: 'b.feature' }))
    fireEvent.click(screen.getAllByRole('button', { name: /Refresh/ })[0]!)

    await waitFor(() => {
      expect(screen.getByText(/Showing current/)).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: 'a.feature' }))

    // b.feature tab should now have a drift dot
    const bTab = screen.getByRole('button', { name: 'b.feature' })
    const driftDot = bTab.querySelector('.review-gate__tab-drift-dot')
    expect(driftDot).toBeDefined()
    expect(driftDot).not.toBeNull()
  })

  // --- Provenance ---

  it('shows provenance: relative path and human-readable size', () => {
    render(
      <ReviewGate
        runId="r1"
        gateId="g1"
        workspaceRoot={workspaceRoot}
        specFiles={[snap('/repo/spec/auth.feature', 'x'.repeat(2048))]}
        plan={snap('/repo/PLAN.md', '# Plan')}
      />
    )
    expect(screen.getByText('spec/auth.feature')).toBeDefined()
    expect(screen.getByText('2.0 KB')).toBeDefined()
  })

  // --- Actions ---

  it('"Request changes" shows a textarea', async () => {
    render(
      <ReviewGate
        runId="r1"
        gateId="g1"
        workspaceRoot={workspaceRoot}
        specFiles={[snap('/repo/spec/a.feature', 'Feature: A')]}
        plan={snap('/repo/PLAN.md', '# Plan')}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Request changes/ }))

    const textbox = screen.getByRole('textbox')
    expect(textbox.tagName.toLowerCase()).toBe('textarea')
  })

  it('onResolved called once after approve', async () => {
    const onResolved = vi.fn()
    render(
      <ReviewGate
        runId="r1"
        gateId="g1"
        workspaceRoot={workspaceRoot}
        specFiles={[snap('/repo/spec/a.feature', 'Feature: A')]}
        plan={snap('/repo/PLAN.md', '# Plan')}
        onResolved={onResolved}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1))
  })

  it('onResolved called once after submit changes (reject)', async () => {
    const onResolved = vi.fn()
    render(
      <ReviewGate
        runId="r1"
        gateId="g1"
        workspaceRoot={workspaceRoot}
        specFiles={[snap('/repo/spec/a.feature', 'Feature: A')]}
        plan={snap('/repo/PLAN.md', '# Plan')}
        onResolved={onResolved}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Request changes/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Please fix the edge case' } })
    fireEvent.click(screen.getByRole('button', { name: /Submit changes/ }))

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1))
  })
})
