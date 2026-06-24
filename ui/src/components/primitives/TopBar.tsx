import './TopBar.css'
import type { ReactNode } from 'react'
import Icon from './Icon.js'

interface TopBarProps {
  title: string
  breadcrumb?: string[]
  onStartFeature?: () => void
  startFeatureDisabled?: boolean
  /**
   * Arbitrary content rendered on the right of the topbar (after the breadcrumb
   * spacer, before the Start-feature CTA). Use for per-page action clusters —
   * e.g. ActiveRun mounts its run-control cluster here.
   */
  rightSlot?: ReactNode
}

export default function TopBar({ title, breadcrumb = [], onStartFeature, startFeatureDisabled, rightSlot }: TopBarProps) {
  return (
    <div className="topbar__root">
      <div className="topbar__crumb">
        <Icon name="workspace" size={14} />
        {breadcrumb.map((seg, i) => (
          <span key={i}>
            {i > 0 && <span className="topbar__crumb-sep">/</span>}
            {i === breadcrumb.length - 1
              ? <span className="topbar__crumb-now">{seg}</span>
              : <span>{seg}</span>
            }
          </span>
        ))}
        {breadcrumb.length === 0 && (
          <span className="topbar__crumb-now">{title}</span>
        )}
      </div>
      <div className="topbar__spacer" />
      {rightSlot}
      {onStartFeature && (
        <button
          className="topbar__cta"
          onClick={startFeatureDisabled ? undefined : onStartFeature}
          disabled={startFeatureDisabled}
          title={startFeatureDisabled ? 'Foundation is missing — run setup first' : undefined}
        >
          {startFeatureDisabled && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          )}
          {!startFeatureDisabled && <Icon name="rocket" size={12} />}
          Start feature
        </button>
      )}
    </div>
  )
}
