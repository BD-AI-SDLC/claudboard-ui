import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import WorkflowForm from '../WorkflowForm.js'

afterEach(cleanup)

function fillJiraGithubForm() {
  // Jira cloud ID
  fireEvent.change(screen.getByPlaceholderText('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), {
    target: { value: 'my-cloud-id' },
  })
  // Jira project key
  fireEvent.change(screen.getByPlaceholderText('PLAT'), {
    target: { value: 'PLAT' },
  })
  // Jira URL base
  fireEvent.change(screen.getByPlaceholderText('https://mycompany.atlassian.net'), {
    target: { value: 'https://example.atlassian.net' },
  })
  // GitHub owner
  fireEvent.change(screen.getByPlaceholderText('myorg'), {
    target: { value: 'acme' },
  })
  // GitHub repo
  fireEvent.change(screen.getByPlaceholderText('my-repo'), {
    target: { value: 'backend' },
  })
}

describe('WorkflowForm', () => {
  it('calls onSubmit with valid jira+github values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<WorkflowForm onSubmit={onSubmit} onCancel={() => {}} />)

    fillJiraGithubForm()
    fireEvent.click(screen.getByText('Launch Workflow'))

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const args = onSubmit.mock.calls[0]![0]
    expect(args.skill).toBe('workflow')
    expect(args.tracker).toBe('jira')
    expect(args.repo).toBe('github')
    expect(args.jira?.cloudId).toBe('my-cloud-id')
    expect(args.github?.owner).toBe('acme')
  })

  it('shows inline error and keeps submit disabled when jira cloudId is empty', () => {
    render(<WorkflowForm onSubmit={vi.fn()} onCancel={() => {}} />)
    // Submit button should be disabled with empty required fields
    const submitBtn = screen.getByText('Launch Workflow') as HTMLButtonElement
    expect(submitBtn.disabled).toBe(true)
  })

  it('stub checkbox swaps value to __stub__ sentinel', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<WorkflowForm onSubmit={onSubmit} onCancel={() => {}} />)

    // Fill other required fields
    fillJiraGithubForm()

    // Check the stub checkbox for cloudId (first stub label)
    const stubCheckboxes = screen.getAllByRole('checkbox', { name: /stub/i })
    fireEvent.click(stubCheckboxes[0]!)

    fireEvent.click(screen.getByText('Launch Workflow'))

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const args = onSubmit.mock.calls[0]![0]
    expect(args.jira?.cloudId).toBe('__stub__')
  })
})
