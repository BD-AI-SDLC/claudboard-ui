import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRef } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import Popover from './Popover.js'

function Harness({
  open,
  onClose,
}: {
  open: boolean
  onClose?: () => void
}) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  return (
    <div>
      <button ref={anchorRef}>anchor</button>
      <button>outside</button>
      <Popover
        anchor={anchorRef}
        open={open}
        onClose={() => onClose?.()}
      >
        <h3 id="title">Confirm?</h3>
        <button>cancel</button>
        <button>confirm</button>
      </Popover>
    </div>
  )
}

describe('Popover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    cleanup()
  })

  it('renders content when open=true and not when open=false', () => {
    const { rerender } = render(<Harness open={false} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(<Harness open={true} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Confirm?')).toBeTruthy()
  })

  it('has role="dialog" and aria-modal', () => {
    render(<Harness open={true} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('moves focus to the first focusable element on open', async () => {
    render(<Harness open={true} />)
    await act(async () => {})
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('cancel')
  })

  it('calls onClose on Escape', () => {
    const onClose = vi.fn()
    render(<Harness open={true} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on click outside (not on anchor)', () => {
    const onClose = vi.fn()
    render(<Harness open={true} onClose={onClose} />)
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT call onClose when clicking inside the popover', () => {
    const onClose = vi.fn()
    render(<Harness open={true} onClose={onClose} />)
    fireEvent.mouseDown(screen.getByText('confirm'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does NOT call onClose when clicking the anchor (parent decides)', () => {
    const onClose = vi.fn()
    render(<Harness open={true} onClose={onClose} />)
    fireEvent.mouseDown(screen.getByText('anchor'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('restores focus to the anchor on close', async () => {
    const { rerender } = render(<Harness open={true} />)
    await act(async () => {})
    rerender(<Harness open={false} />)
    await act(async () => {})
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('anchor')
  })

  it('Tab from the last focusable wraps to the first (focus trap)', () => {
    render(<Harness open={true} />)
    const confirm = screen.getByText('confirm') as HTMLButtonElement
    confirm.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('cancel')
  })

  it('Shift+Tab from the first focusable wraps to the last', () => {
    render(<Harness open={true} />)
    const cancel = screen.getByText('cancel') as HTMLButtonElement
    cancel.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('confirm')
  })
})
