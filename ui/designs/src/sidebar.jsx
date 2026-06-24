/* eslint-disable */
/* Sidebar: workspace switcher, nav, theme toggle, workflow gate */

const Lock = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline-block" }}>
    <rect x="4" y="11" width="16" height="10" rx="2"/>
    <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
  </svg>
);

const Sidebar = ({ screen, setScreen, project, theme, setTheme, workflowInstalled = true }) => {
  const D = window.DATA;
  const running = D.run;

  // Workspace gate — these require feature-workflow to be installed.
  // Visible-but-disabled when not installed.
  const gated = ["kickoff", "run", "gate"];

  const nav = [
    { id: "dashboard", label: "Overview",         icon: "home"    },
    { id: "project",   label: "Project · health", icon: "shield"  },
    { id: "kickoff",   label: "Start feature",    icon: "rocket"  },
    { id: "run",       label: "Active run",       icon: "pulse", count: workflowInstalled ? 1 : null },
    { id: "gate",      label: "Review gate",      icon: "flag",  count: workflowInstalled ? 1 : null, accent: "amber" },
  ];

  const lower = [
    { id: "analytics", label: "Analytics",     icon: "spark", href: "Analytics.html" },
    { id: "history",   label: "Run history",   icon: "history" },
    { id: "skills",    label: "Skills",        icon: "skill"   },
    { id: "rules",     label: "Rules",         icon: "book"    },
    { id: "settings",  label: "Settings",      icon: "settings"},
  ];

  return (
    <aside className="side">
      <div className="side-head">
        <div className="brand">
          <span className="brand-mark">
            <svg viewBox="0 0 24 24" width="100%" height="100%">
              <rect x="12" y="5" width="7" height="7" rx="2" fill="#08090a" opacity="0.32"/>
              <rect x="5" y="12" width="7" height="7" rx="2" fill="#08090a"/>
            </svg>
          </span>
          <span className="brandword">claud<span className="wbd">board</span></span>
          <small>v1.4</small>
        </div>
        <div className="workspace-picker" onClick={() => setScreen("dashboard")}>
          <span className="ws-icon">M</span>
          <span className="ws-name">meas <span style={{ color: "var(--muted)" }}>workspace</span></span>
          <span className="ws-chev"><Icon name="chev" size={12} /></span>
        </div>
      </div>

      <nav className="side-nav">
        <div className="nav-section">
          <div className="nav-label">Workflow</div>
          {nav.map(n => {
            const locked = gated.includes(n.id) && !workflowInstalled;
            return (
              <div
                key={n.id}
                className={cls("nav-item", screen === n.id && "active", locked && "locked")}
                onClick={() => {
                  if (locked) return;
                  setScreen(n.id);
                }}
                title={locked ? "Install /claudboard-workflow first" : undefined}
              >
                <Icon name={n.icon} size={14} className="nav-ico" />
                <span>{n.label}</span>
                {locked ? (
                  <span className="nav-lock"><Lock size={11} /></span>
                ) : (
                  n.count != null && (
                    <span
                      className="nav-count"
                      style={n.accent === "amber" ? { background: "var(--amber-dim)", color: "var(--amber)" } : null}
                    >{n.count}</span>
                  )
                )}
              </div>
            );
          })}

          {workflowInstalled && (
            <div
              className="nav-running"
              style={{ marginTop: "8px" }}
              onClick={() => setScreen("run")}
            >
              <div className="nr-top">
                <span className="dot pulse" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor" }}></span>
                RUNNING · {running.elapsed}
              </div>
              <div className="nr-title">{running.ticket} · {running.title}</div>
              <div className="nr-meta">{running.repo} · phase 1/7 · paused at gate</div>
            </div>
          )}

          {!workflowInstalled && (
            <div
              className="nav-setup"
              onClick={() => setScreen("project")}
              title="Run /claudboard-workflow to unlock feature runs"
            >
              <div className="nr-top">
                <Lock size={10} />
                SETUP REQUIRED
              </div>
              <div className="nr-title">feature-workflow not installed</div>
              <div className="nr-meta">2 of 3 foundation steps done</div>
            </div>
          )}
        </div>

        <div className="nav-section">
          <div className="nav-label">Project</div>
          {lower.map(n => (
            <a
              key={n.id}
              href={n.href || "#"}
              className={cls("nav-item", screen === n.id && "active")}
              onClick={(e) => { if (!n.href) { e.preventDefault(); setScreen(n.id); } }}
            >
              <Icon name={n.icon} size={14} className="nav-ico" />
              <span>{n.label}</span>
            </a>
          ))}
        </div>

        <div className="nav-section">
          <div className="nav-label">Repos in workspace · {window.DATA.projects.length}</div>
          {window.DATA.projects.slice(0, 5).map(p => {
            const r = (window.DATA.setup?.repoReadiness || {})[p.id];
            return (
              <div
                key={p.id}
                className={cls("nav-item", project === p.id && "active")}
                style={{ paddingLeft: "8px" }}
                onClick={() => setScreen("project")}
              >
                <span style={{
                  width: "14px", height: "14px",
                  borderRadius: "3px",
                  background: r && r.hasWorkflow ? "var(--surface-2)" : "var(--amber-dim)",
                  fontSize: "8px",
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  display: "grid", placeItems: "center",
                  color: r && r.hasWorkflow ? "var(--text-2)" : "var(--amber)",
                }}>{p.mark}</span>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                {r && !r.hasWorkflow && (
                  <span style={{
                    marginLeft: "auto",
                    fontSize: "9px",
                    color: "var(--amber)",
                    fontFamily: "var(--font-mono)",
                  }}>{r.done}/{r.total}</span>
                )}
                {r && r.hasWorkflow && p.lastRunStatus === "running" && (
                  <span className="dot pulse" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--teal)", marginLeft: "auto" }}></span>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      <div className="side-foot">
        <div className="theme-tog">
          <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")} aria-label="Dark">
            <Icon name="moon" size={11} />
          </button>
          <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")} aria-label="Light">
            <Icon name="sun" size={11} />
          </button>
        </div>
        <div className="who">
          <span className="av">LB</span>
        </div>
      </div>
    </aside>
  );
};

window.Sidebar = Sidebar;
