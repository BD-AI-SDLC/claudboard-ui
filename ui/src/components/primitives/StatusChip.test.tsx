import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import StatusChip from './StatusChip.js'

describe('StatusChip', () => {
  afterEach(() => cleanup())

  it('renders the cancelled status with slate variant and "Cancelled" label', () => {
    const { container } = render(<StatusChip status="cancelled" />)
    expect(screen.getByText('Cancelled')).toBeTruthy()
    const root = container.querySelector('.status-chip__root')
    expect(root?.className).toContain('status-chip--slate')
    // Cancelled does NOT pulse — it's terminal, not awaiting anything
    expect(container.querySelector('.status-chip__dot--pulse')).toBeNull()
  })

  it('renders running with teal + pulse', () => {
    const { container } = render(<StatusChip status="running" />)
    expect(screen.getByText('Running')).toBeTruthy()
    const root = container.querySelector('.status-chip__root')
    expect(root?.className).toContain('status-chip--teal')
    expect(container.querySelector('.status-chip__dot--pulse')).toBeTruthy()
  })

  it('renders unknown status as default with raw label', () => {
    const { container } = render(<StatusChip status="weird-state" />)
    expect(screen.getByText('weird-state')).toBeTruthy()
    const root = container.querySelector('.status-chip__root')
    expect(root?.className).toContain('status-chip--default')
  })
})
