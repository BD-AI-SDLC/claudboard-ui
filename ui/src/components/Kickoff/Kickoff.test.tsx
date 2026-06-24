import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { Repo, Autonomy } from '@bosch-sdlc/protocol'
import Kickoff from './Kickoff.js'

const REPO_BASE: Omit<Repo, 'defaultAutonomy' | 'featureWorkflowProjectKey'> = {
  id: 'repo-1',
  projectId: 'proj-1',
  path: '/tmp/repo',
  name: 'repo',
  topology: 'monolith',
  status: 'active',
  prereqs: {},
}

function makeRepo(
  defaultAutonomy: Autonomy = 'balanced',
  featureWorkflowProjectKey: string | null = null,
): Repo {
  return { ...REPO_BASE, defaultAutonomy, featureWorkflowProjectKey }
}

const getRepo = vi.fn()
const createRun = vi.fn()
const getRun = vi.fn()
const getRepoPrereqs = vi.fn()

vi.mock('../../api/client.js', () => ({
  api: {
    getRepo: (...args: unknown[]) => getRepo(...args),
    createRun: (...args: unknown[]) => createRun(...args),
    getRun: (...args: unknown[]) => getRun(...args),
    getRepoPrereqs: (...args: unknown[]) => getRepoPrereqs(...args),
  },
}))

vi.mock('../primitives/Icon.js', () => ({
  default: () => null,
}))
vi.mock('../primitives/StatusChip.js', () => ({
  default: () => null,
}))
vi.mock('../primitives/TopBar.js', () => ({
  default: () => null,
}))

describe('Kickoff autonomy selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createRun.mockResolvedValue({ id: 'run-1' })
    getRepoPrereqs.mockResolvedValue({})
  })
  afterEach(() => { cleanup() })

  it('initialises the radio from the repo default', async () => {
    getRepo.mockResolvedValue(makeRepo('guided'))
    render(<Kickoff projectId="repo-1" />)
    await waitFor(() => {
      const guided = screen.getByRole('radio', { name: /guided/i }) as HTMLInputElement
      expect(guided.checked).toBe(true)
    })
  })

  it('falls back to balanced when the repo default is balanced', async () => {
    getRepo.mockResolvedValue(makeRepo('balanced'))
    render(<Kickoff projectId="repo-1" />)
    await waitFor(() => {
      const balanced = screen.getByRole('radio', { name: /balanced/i }) as HTMLInputElement
      expect(balanced.checked).toBe(true)
    })
  })

  it('disables Submit until the repo record loads', async () => {
    let resolveRepo: ((p: Repo) => void) | undefined
    getRepo.mockReturnValue(new Promise<Repo>((resolve) => { resolveRepo = resolve }))
    render(<Kickoff projectId="repo-1" />)

    const textarea = screen.getByPlaceholderText(/Describe the feature/) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Add CSV export' } })

    const submit = screen.getByRole('button', { name: /Start feature|Starting/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    resolveRepo!(makeRepo('balanced'))
    await waitFor(() => {
      expect((screen.getByRole('button', { name: /Start feature/ }) as HTMLButtonElement).disabled).toBe(false)
    })
  })

  it.each(['autopilot', 'balanced', 'guided', 'manual'] as const)(
    'submits autonomy=%s in the createRun payload',
    async (level) => {
      getRepo.mockResolvedValue(makeRepo('balanced'))
      render(<Kickoff projectId="repo-1" />)

      await waitFor(() => screen.getByRole('radio', { name: /balanced/i }))

      const textarea = screen.getByPlaceholderText(/Describe the feature/) as HTMLTextAreaElement
      fireEvent.change(textarea, { target: { value: 'Add CSV export' } })

      const radio = screen.getByRole('radio', { name: new RegExp(level, 'i') }) as HTMLInputElement
      fireEvent.click(radio)

      const submit = screen.getByRole('button', { name: /Start feature/ })
      fireEvent.click(submit)

      await waitFor(() => {
        expect(createRun).toHaveBeenCalledWith({
          repoId: 'repo-1',
          prompt: 'Add CSV export',
          target: '/tmp/repo',
          autonomy: level,
        })
      })
    },
  )

  it('echoes the selected autonomy in the preview pane', async () => {
    getRepo.mockResolvedValue(makeRepo('balanced'))
    const { container } = render(<Kickoff projectId="repo-1" />)

    await waitFor(() => screen.getByRole('radio', { name: /balanced/i }))

    fireEvent.click(screen.getByRole('radio', { name: /manual/i }))
    await waitFor(() => {
      const preview = container.querySelector('.kickoff__preview')
      expect(preview).not.toBeNull()
      expect(preview!.textContent).toMatch(/autonomy:\s*manual/)
    })
  })

  it('does not render a foundation drift hint', async () => {
    getRepo.mockResolvedValue(makeRepo('balanced'))
    render(<Kickoff projectId="repo-1" />)
    await waitFor(() => screen.getByRole('radio', { name: /balanced/i }))
    expect(screen.queryByText(/Foundation may be out of date/)).toBeNull()
    expect(screen.queryByText(/refresh first/)).toBeNull()
  })
})

describe('Kickoff branch preview project key', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRepoPrereqs.mockResolvedValue({})
  })
  afterEach(() => { cleanup() })

  it('renders the configured project key in teal', async () => {
    getRepo.mockResolvedValue(makeRepo('balanced', 'PLAT'))
    const { container } = render(<Kickoff projectId="repo-1" />)
    await waitFor(() => screen.getByRole('radio', { name: /balanced/i }))

    const preview = container.querySelector('.kickoff__preview')
    expect(preview).not.toBeNull()
    expect(preview!.textContent).toContain('feature/PLAT-NNNN/new-feature')

    const branchSpan = Array.from(preview!.querySelectorAll('span'))
      .find((s) => s.textContent === 'feature/PLAT-NNNN/new-feature') as HTMLSpanElement | undefined
    expect(branchSpan).toBeDefined()
    expect(branchSpan!.style.color).toBe('var(--teal)')
  })

  it('renders <project key> placeholder in muted when no key is configured', async () => {
    getRepo.mockResolvedValue(makeRepo('balanced', null))
    const { container } = render(<Kickoff projectId="repo-1" />)
    await waitFor(() => screen.getByRole('radio', { name: /balanced/i }))

    const preview = container.querySelector('.kickoff__preview')
    expect(preview).not.toBeNull()
    expect(preview!.textContent).toContain('feature/<project key>-NNNN/new-feature')

    const branchSpan = Array.from(preview!.querySelectorAll('span'))
      .find((s) => s.textContent === 'feature/<project key>-NNNN/new-feature') as HTMLSpanElement | undefined
    expect(branchSpan).toBeDefined()
    expect(branchSpan!.style.color).toBe('var(--muted)')
  })

  it('updates the slug live while the project key stays stable', async () => {
    getRepo.mockResolvedValue(makeRepo('balanced', 'PLAT'))
    const { container } = render(<Kickoff projectId="repo-1" />)
    await waitFor(() => screen.getByRole('radio', { name: /balanced/i }))

    const textarea = screen.getByPlaceholderText(/Describe the feature/) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Migrate scheduler off Quartz' } })

    await waitFor(() => {
      const preview = container.querySelector('.kickoff__preview')
      expect(preview!.textContent).toContain('feature/PLAT-NNNN/migrate-scheduler-off-quartz')
    })
  })
})

describe('Kickoff prefill from source run (Restart flow)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRepoPrereqs.mockResolvedValue({})
    getRepo.mockResolvedValue(makeRepo('balanced'))
  })
  afterEach(() => { cleanup() })

  it('renders empty form when prefillRunId is null', async () => {
    render(<Kickoff projectId="repo-1" prefillRunId={null} />)
    await waitFor(() => screen.getByRole('radio', { name: /balanced/i }))
    expect(getRun).not.toHaveBeenCalled()
    const textarea = screen.getByPlaceholderText(/Describe the feature/) as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })

  it('with prefillRunId, calls api.getRun and populates prompt + autonomy', async () => {
    getRun.mockResolvedValue({
      id: 'src-run', repoId: 'repo-1', kind: 'feature', status: 'failed',
      prompt: 'Add the outbox dispatcher', target: '/tmp/repo',
      transcriptPath: '/tmp/t.jsonl', createdAt: '2026-05-29T10:00:00Z',
      completedAt: null, cost: null, inputTokens: null, outputTokens: null,
      autonomy: 'manual', errorMessage: null,
    })
    render(<Kickoff projectId="repo-1" prefillRunId="src-run" />)
    await waitFor(() => expect(getRun).toHaveBeenCalledWith('src-run'))
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/Describe the feature/) as HTMLTextAreaElement
      expect(textarea.value).toBe('Add the outbox dispatcher')
      const manual = screen.getByRole('radio', { name: /manual/i }) as HTMLInputElement
      expect(manual.checked).toBe(true)
    })
  })

  it('with prefillRunId, prefill overrides the repo defaultAutonomy', async () => {
    // Repo default is balanced; source run uses autopilot — prefill should win.
    getRun.mockResolvedValue({
      id: 'src-run', repoId: 'repo-1', kind: 'feature', status: 'cancelled',
      prompt: 'Something', target: '/tmp/repo',
      transcriptPath: '/tmp/t.jsonl', createdAt: '2026-05-29T10:00:00Z',
      completedAt: null, cost: null, inputTokens: null, outputTokens: null,
      autonomy: 'autopilot', errorMessage: null,
    })
    render(<Kickoff projectId="repo-1" prefillRunId="src-run" />)
    await waitFor(() => {
      const autopilot = screen.getByRole('radio', { name: /autopilot/i }) as HTMLInputElement
      expect(autopilot.checked).toBe(true)
    })
  })

  it('renders an inline notice when api.getRun fails', async () => {
    getRun.mockRejectedValue(new Error('boom'))
    render(<Kickoff projectId="repo-1" prefillRunId="missing" />)
    await waitFor(() => {
      expect(screen.getByText(/Could not pre-fill from run missing/)).toBeTruthy()
    })
    const textarea = screen.getByPlaceholderText(/Describe the feature/) as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })
})

describe('Kickoff legacy recent-runs panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRepoPrereqs.mockResolvedValue({})
    getRepo.mockResolvedValue(makeRepo('balanced'))
  })
  afterEach(() => { cleanup() })

  it('does not render the legacy "Recent in this repo" panel', async () => {
    const { container } = render(<Kickoff projectId="repo-1" />)
    await waitFor(() => screen.getByRole('radio', { name: /balanced/i }))
    expect(screen.queryByText(/Recent in this repo/i)).toBeNull()
    expect(container.querySelector('.kickoff__recent-card')).toBeNull()
  })
})
