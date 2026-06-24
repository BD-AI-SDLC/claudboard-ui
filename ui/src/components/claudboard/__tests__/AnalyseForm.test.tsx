import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import AnalyseForm from '../AnalyseForm.js'

afterEach(cleanup)

describe('AnalyseForm', () => {
  it('calls onSubmit with skill=analyse and form values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<AnalyseForm onSubmit={onSubmit} onCancel={() => {}} />)

    fireEvent.click(screen.getByText('Launch Analyse'))

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const args = onSubmit.mock.calls[0]!
    expect(args[0]).toMatchObject({
      skill: 'analyse',
      ecosystemLevel: false,
      acceptTopology: true,
    })
  })

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn()
    render(<AnalyseForm onSubmit={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('submits ecosystemLevel=true when checkbox is checked', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<AnalyseForm onSubmit={onSubmit} onCancel={() => {}} />)

    const checkboxes = screen.getAllByRole('checkbox')
    // first checkbox is ecosystemLevel
    fireEvent.click(checkboxes[0]!)
    fireEvent.click(screen.getByText('Launch Analyse'))

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ ecosystemLevel: true })
  })

  it('disables submit button while submitting', () => {
    render(<AnalyseForm onSubmit={vi.fn()} onCancel={() => {}} submitting />)
    const btn = screen.getByText('Launching…') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})
