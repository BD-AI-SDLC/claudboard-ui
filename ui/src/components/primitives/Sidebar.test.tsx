import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import Sidebar from './Sidebar.js'

const baseProps = {
  activeRoute: 'dashboard',
  repos: [],
  runs: [],
  lastVisitedRepoId: null,
  theme: 'dark' as const,
  setTheme: vi.fn(),
  onNavigateDashboard: vi.fn(),
  onNavigateRepo: vi.fn(),
  onStartFeature: vi.fn(),
  onNavigateRun: vi.fn(),
  onNavigateGate: vi.fn(),
  activeProject: null,
  projects: [],
  onSwitchProject: vi.fn(),
  onAddProject: vi.fn(),
}

describe('Sidebar', () => {
  afterEach(() => cleanup())

  it('renders the Workflow section with the real nav entries', () => {
    render(<Sidebar {...baseProps} />)
    expect(screen.getByText('Workflow')).toBeTruthy()
    expect(screen.getByText('Overview')).toBeTruthy()
    expect(screen.getByText('Project setup')).toBeTruthy()
    expect(screen.getByText('Start feature')).toBeTruthy()
    expect(screen.getByText('Active run')).toBeTruthy()
    expect(screen.getByText('Review gate')).toBeTruthy()
  })

  it('does not render the legacy "Coming soon" placeholder section', () => {
    const { container } = render(<Sidebar {...baseProps} />)

    // None of the four removed labels should appear anywhere in the DOM.
    expect(screen.queryByText(/^Run history$/)).toBeNull()
    expect(screen.queryByText(/^Skills$/)).toBeNull()
    expect(screen.queryByText(/^Rules$/)).toBeNull()
    expect(screen.queryByText(/^Settings$/)).toBeNull()

    // No .sidebar__section-label should have text "Project". ProjectSwitcher
    // may include the word "Project" elsewhere; this assertion narrows to the
    // section-label class only so the removed section header cannot creep back.
    const labels = container.querySelectorAll('.sidebar__section-label')
    expect(Array.from(labels).map((el) => el.textContent)).not.toContain('Project')
  })
})
