import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import './Popover.css'

type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'

interface PopoverProps {
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  placement?: Placement
  children: ReactNode
  labelledBy?: string
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Popover({
  anchor,
  open,
  onClose,
  placement = 'bottom-end',
  children,
  labelledBy,
}: PopoverProps) {
  const popRef = useRef<HTMLDivElement | null>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // Position the popover relative to its anchor.
  useLayoutEffect(() => {
    if (!open) return
    const reposition = () => {
      const el = popRef.current
      const a = anchor.current
      if (!el || !a) return
      const r = a.getBoundingClientRect()
      const gap = 6
      el.style.position = 'fixed'
      if (placement === 'bottom-start') {
        el.style.top = `${r.bottom + gap}px`
        el.style.left = `${r.left}px`
        el.style.right = ''
      } else if (placement === 'bottom-end') {
        el.style.top = `${r.bottom + gap}px`
        el.style.left = ''
        el.style.right = `${window.innerWidth - r.right}px`
      } else if (placement === 'top-start') {
        el.style.bottom = `${window.innerHeight - r.top + gap}px`
        el.style.top = ''
        el.style.left = `${r.left}px`
        el.style.right = ''
      } else {
        el.style.bottom = `${window.innerHeight - r.top + gap}px`
        el.style.top = ''
        el.style.left = ''
        el.style.right = `${window.innerWidth - r.right}px`
      }
    }
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, anchor, placement])

  // Focus management: trap focus inside the popover while open;
  // restore focus to the anchor on close.
  useEffect(() => {
    if (!open) return
    previouslyFocused.current = (document.activeElement as HTMLElement) ?? null
    const el = popRef.current
    if (el) {
      const first = el.querySelector<HTMLElement>(FOCUSABLE)
      first?.focus()
    }
    return () => {
      const back = anchor.current ?? previouslyFocused.current
      back?.focus?.()
    }
  }, [open, anchor])

  // ESC + click-outside + focus-trap key handlers.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const el = popRef.current
      if (!el) return
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    const onMouseDown = (e: MouseEvent) => {
      const el = popRef.current
      const a = anchor.current
      const target = e.target as Node
      if (!el || !target) return
      if (el.contains(target)) return
      if (a && a.contains(target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [open, onClose, anchor])

  if (!open) return null

  return (
    <div
      ref={popRef}
      className="popover-card"
      role="dialog"
      aria-modal="true"
      {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
    >
      {children}
    </div>
  )
}
