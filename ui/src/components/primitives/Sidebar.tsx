import './Sidebar.css'
import Icon from './Icon.js'
import BrandMark from './BrandMark.js'
import type {
  Project,
  Repo,
  Run,
  SpecPlanGateEventPayload,
} from '@bosch-sdlc/protocol'
import ProjectSwitcher from '../ProjectSwitcher/ProjectSwitcher.js'
import { foundationExists } from '../Project/setup-utils.js'

interface SidebarProps {
  activeRoute: string
  repos: Repo[]
  runs: Run[]
  lastVisitedRepoId: string | null
  theme: 'dark' | 'light'
  setTheme: (t: 'dark' | 'light') => void
  onNavigateDashboard: () => void
  onNavigateRepo: (id: string) => void
  onStartFeature: () => void
  onNavigateRun: (id: string) => void
  onNavigateGate: (
    runId: string,
    gateId: string,
    kind?: string,
    questions?: string[],
    specPlan?: SpecPlanGateEventPayload | null,
  ) => void
  activeProject: Project | null
  projects: Project[]
  onSwitchProject: (id: string) => void
  onAddProject: () => void
}

export default function Sidebar({
  activeRoute,
  repos,
  runs,
  lastVisitedRepoId,
  theme,
  setTheme,
  onNavigateDashboard,
  onNavigateRepo,
  onStartFeature,
  onNavigateRun,
  onNavigateGate,
  activeProject,
  projects,
  onSwitchProject,
  onAddProject,
}: SidebarProps) {
  const targetRepo =
    repos.find((r) => r.id === lastVisitedRepoId) ?? repos[0] ?? null

  const startFeatureTargetRepo =
    (targetRepo && foundationExists(targetRepo.prereqs) ? targetRepo : null) ??
    repos.find((r) => foundationExists(r.prereqs)) ??
    null

  const getDate = (r: Run) => r.createdAt ?? ''

  const activeRun =
    [...runs]
      .sort((a, b) => getDate(b).localeCompare(getDate(a)))
      .find((r) => r.status === 'running' || r.status === 'paused-user') ?? null

  const gateRun =
    [...runs]
      .sort((a, b) => getDate(a).localeCompare(getDate(b)))
      .find((r) => r.status === 'paused-gate' && r.openGate) ?? null

  interface NavItemConfig {
    id: string
    label: string
    icon: string
    enabled: boolean
    tooltip?: string
    handler: () => void
  }

  const navItems: NavItemConfig[] = [
    {
      id: 'dashboard',
      label: 'Overview',
      icon: 'home',
      enabled: true,
      handler: onNavigateDashboard,
    },
    {
      id: 'project',
      label: 'Project setup',
      icon: 'shield',
      enabled: targetRepo !== null,
      tooltip: targetRepo ? undefined : 'Attach a repo first',
      handler: () => { if (targetRepo) onNavigateRepo(targetRepo.id) },
    },
    {
      id: 'kickoff',
      label: 'Start feature',
      icon: 'rocket',
      enabled: startFeatureTargetRepo !== null,
      tooltip: repos.length < 1
        ? 'Attach a repo first'
        : startFeatureTargetRepo === null
          ? 'Complete foundation setup on at least one project first'
          : undefined,
      handler: onStartFeature,
    },
    {
      id: 'run',
      label: 'Active run',
      icon: 'pulse',
      enabled: activeRun !== null,
      tooltip: activeRun ? undefined : 'No active runs',
      handler: () => { if (activeRun) onNavigateRun(activeRun.id) },
    },
    {
      id: 'gate',
      label: 'Review gate',
      icon: 'flag',
      enabled: gateRun !== null,
      tooltip: gateRun ? undefined : 'No gates awaiting review',
      handler: () => {
        if (gateRun && gateRun.openGate) {
          const gate = gateRun.openGate
          if (gate.kind === 'clarify') {
            onNavigateRun(gateRun.id)
          } else {
            const specPlan: SpecPlanGateEventPayload | null =
              gate.snapshot && gate.kind === 'spec+plan'
                ? ({ ...(gate.payload as object), snapshot: gate.snapshot } as SpecPlanGateEventPayload)
                : null
            onNavigateGate(gateRun.id, gate.id, gate.kind, undefined, specPlan)
          }
        }
      },
    },
  ]

  function renderNavItem(item: NavItemConfig) {
    const active = activeRoute === item.id
    const disabled = !item.enabled

    return (
      <div
        key={item.id}
        className={`sidebar__item${disabled ? ' sidebar__item--disabled' : ''}${active ? ' sidebar__item--active' : ''}`}
        onClick={disabled ? undefined : item.handler}
        role="button"
        aria-disabled={disabled ? 'true' : undefined}
        tabIndex={disabled ? -1 : 0}
        title={disabled ? item.tooltip : undefined}
        onKeyDown={disabled ? undefined : (e) => e.key === 'Enter' && item.handler()}
      >
        <Icon name={item.icon} size={14} className="sidebar__item-icon" />
        <span>{item.label}</span>
      </div>
    )
  }

  return (
    <aside className="sidebar__root">
      <div className="sidebar__head">
        <div className="sidebar__brand">
          <BrandMark size={20} />
          <span className="sidebar__brand-wordmark">
            <span className="sidebar__brand-claud">claud</span><span className="sidebar__brand-board">board</span>
          </span>
          <span className="sidebar__brand-version">v0.1</span>
        </div>
        <ProjectSwitcher
          activeProject={activeProject}
          projects={projects}
          runs={runs}
          onSwitch={onSwitchProject}
          onAdd={onAddProject}
        />
      </div>

      <nav className="sidebar__nav">
        <div className="sidebar__section">
          <div className="sidebar__section-label">Workflow</div>
          {navItems.map(renderNavItem)}
        </div>
      </nav>

      <div className="sidebar__foot">
        <div className="sidebar__theme-tog">
          <button
            className={`sidebar__theme-tog-btn${theme === 'dark' ? ' sidebar__theme-tog-btn--on' : ''}`}
            aria-label="Dark"
            aria-pressed={theme === 'dark' ? 'true' : 'false'}
            onClick={() => setTheme('dark')}
          >
            <Icon name="moon" size={11} />
          </button>
          <button
            className={`sidebar__theme-tog-btn${theme === 'light' ? ' sidebar__theme-tog-btn--on' : ''}`}
            aria-label="Light"
            aria-pressed={theme === 'light' ? 'true' : 'false'}
            onClick={() => setTheme('light')}
          >
            <Icon name="sun" size={11} />
          </button>
        </div>
      </div>
    </aside>
  )
}
