import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ImportView from './ImportView.js'

vi.mock('../../api/client.js', () => ({
  api: {
    createProject: vi.fn().mockResolvedValue({ id: 'p1' }),
    setActiveProject: vi.fn().mockResolvedValue({}),
  },
}))

vi.mock('../primitives/Icon.js', () => ({
  default: ({ name }: { name: string }) => <span data-icon={name} />,
}))

vi.mock('../Attach/AttachRepoModal.js', () => ({
  default: () => <div data-testid="attach-repo-modal" />,
}))

describe('ImportView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('does not render the clone-from-git-url card', () => {
    render(<ImportView isAddMode={false} onAttach={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText(/clone from git url/i)).toBeNull()
  })

  it('does not render a repository URL label', () => {
    render(<ImportView isAddMode={false} onAttach={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText(/repository url/i)).toBeNull()
  })

  it('does not render a github-placeholder input', () => {
    render(<ImportView isAddMode={false} onAttach={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByPlaceholderText(/github\.com/i)).toBeNull()
  })

  it('add-mode subtitle does not mention cloning', () => {
    render(<ImportView isAddMode={true} onAttach={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText(/clone/i)).toBeNull()
  })

  it('clicking the folder card transitions to the folder browser', () => {
    render(<ImportView isAddMode={false} onAttach={vi.fn()} onCancel={vi.fn()} />)
    const folderCard = screen.getByText('Open local folder')
    fireEvent.click(folderCard)
    expect(screen.getByTestId('attach-repo-modal')).toBeDefined()
  })
})
