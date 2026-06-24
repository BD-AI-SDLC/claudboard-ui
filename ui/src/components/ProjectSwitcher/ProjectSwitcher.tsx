import './ProjectSwitcher.css'
import { useState, useRef, useEffect } from 'react'
import type { Project, Run } from '@bosch-sdlc/protocol'
import Icon from '../primitives/Icon.js'

interface ProjectSwitcherProps {
  activeProject: Project | null
  projects: Project[]
  runs: Run[]
  onSwitch: (id: string) => void
  onAdd: () => void
}

function relativeAge(iso: string | null | undefined): string {
  if (!iso) return 'idle'
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 1) { const m = Math.floor(diff / 60000); return m < 1 ? 'now' : `${m}m` }
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function deriveMark(t: string | undefined): 'mono' | 'multi' | 'monoz' {
  if (t === 'monolith') return 'mono'
  if (t === 'monorepo') return 'monoz'
  return 'multi'
}

function topologyLabel(t: string | undefined): string {
  if (t === 'multi-repo-workspace') return 'multi-repo'
  if (t === 'monorepo') return 'monorepo'
  return 'monolith'
}

export default function ProjectSwitcher({ activeProject, projects, runs, onSwitch, onAdd }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleMousedown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleMousedown)
    return () => document.removeEventListener('mousedown', handleMousedown)
  }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  function activity(project: Project): string {
    // Runs are scoped to the active project, so we can only show real status for it
    if (project.id === activeProject?.id) {
      if (runs.some(r => r.status === 'running')) return 'running'
      if (runs.some(r => r.status === 'paused-gate')) return 'gate'
    }
    return relativeAge(project.lastActiveAt ?? project.createdAt)
  }

  const sorted = [...projects].sort((a, b) => {
    if (a.id === activeProject?.id) return -1
    if (b.id === activeProject?.id) return 1
    const at = a.lastActiveAt ?? a.createdAt ?? ''
    const bt = b.lastActiveAt ?? b.createdAt ?? ''
    return bt.localeCompare(at)
  })

  return (
    <div className={`ps-sw ${open ? 'ps-sw--open' : ''}`} ref={ref}>
      <div className="ps-sw__trigger" onClick={() => setOpen(v => !v)}>
        <div className={`ps-sw__mark ps-sw__mark--${deriveMark(activeProject?.topology ?? undefined)}`}>
          {activeProject?.mark ?? '?'}
        </div>
        <div className="ps-sw__info">
          <div className="ps-sw__name">{activeProject?.name ?? 'No project'}</div>
          <div className="ps-sw__type">{topologyLabel(activeProject?.topology ?? undefined)}</div>
        </div>
        <Icon name="chev" size={12} className="ps-sw__chev" />
      </div>

      {open && (
        <div className="ps-sw__dropdown">
          <div className="ps-sw__header">
            {projects.length} project{projects.length !== 1 ? 's' : ''}
          </div>
          {sorted.map(project => {
            const act = activity(project)
            const isActive = project.id === activeProject?.id
            return (
              <div
                key={project.id}
                className={`ps-sw__row${isActive ? ' ps-sw__row--active' : ''}`}
                onClick={() => { onSwitch(project.id); setOpen(false) }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && (onSwitch(project.id), setOpen(false))}
              >
                <div className={`ps-sw__mark ps-sw__mark--${deriveMark(project.topology)}`} style={{ fontSize: '9px', width: '16px', height: '16px' }}>
                  {project.mark}
                </div>
                <div className="ps-sw__row-info">
                  <div className="ps-sw__row-name">{project.name}</div>
                  <div className="ps-sw__row-type">{topologyLabel(project.topology)}</div>
                </div>
                <div className="ps-sw__activity">
                  {act === 'running' && <span className="ps-sw__dot ps-sw__dot--teal ps-sw__dot--pulse" />}
                  {act === 'gate'    && <span className="ps-sw__dot ps-sw__dot--violet" />}
                  {act !== 'running' && act !== 'gate' && <span className="ps-sw__age">{act}</span>}
                </div>
              </div>
            )
          })}
          <div className="ps-sw__sep" />
          <div className="ps-sw__action" onClick={() => { onAdd(); setOpen(false) }}>
            <span className="ps-sw__action-ico">+</span>
            Add project
          </div>
          <div
            className="ps-sw__action ps-sw__action--disabled"
            aria-disabled="true"
            title="Coming soon"
            onClick={e => e.stopPropagation()}
          >
            <span className="ps-sw__action-ico">&#9881;</span>
            Manage projects
          </div>
        </div>
      )}
    </div>
  )
}
