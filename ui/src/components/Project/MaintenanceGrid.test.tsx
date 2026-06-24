import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import MaintenanceGrid from './MaintenanceGrid.js'
import type { PrereqRecord } from '@bosch-sdlc/protocol'

function makePrereq(cmd: PrereqRecord['cmd'], state: PrereqRecord['state'] = 'done'): PrereqRecord {
  return {
    id: cmd,
    repoId: 'p1',
    cmd,
    state,
    lastRun: '2026-05-25T00:00:00Z',
    duration: 1000,
    cost: 1,
    output: null,
    staleReason: null,
  }
}

const opsAllDone: Record<string, PrereqRecord> = {
  analyse: makePrereq('analyse'),
  generate: makePrereq('generate'),
  'workflow': makePrereq('workflow'),
  refresh: makePrereq('refresh', 'stale'),
  techdebt: makePrereq('techdebt', 'done'),
}

afterEach(() => { cleanup() })

describe('MaintenanceGrid', () => {
  it('renders Refresh and Tech debt cards', () => {
    render(
      <MaintenanceGrid
        prereqs={opsAllDone}
        running={{}}
        onRun={vi.fn()}
      />
    )
    expect(screen.getAllByText('Refresh').length).toBeGreaterThan(0)
    expect(screen.getByText('Tech debt')).toBeTruthy()
  })

  it('does not render a Recommended chip', () => {
    render(
      <MaintenanceGrid
        prereqs={opsAllDone}
        running={{}}
        onRun={vi.fn()}
      />
    )
    expect(screen.queryByText('Recommended')).toBeNull()
  })

  it('Refresh card description emphasizes drift-management role', () => {
    render(
      <MaintenanceGrid
        prereqs={opsAllDone}
        running={{}}
        onRun={vi.fn()}
      />
    )
    expect(screen.getByText('Updates rules and skills to match recent code changes. Run when the codebase has drifted.')).toBeTruthy()
  })
})
