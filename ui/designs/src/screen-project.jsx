/* eslint-disable */
/* Project · health — vertical operations with dependency chain + setup banner */

const ScreenProject = ({ goto, workflowInstalled }) => {
  const D = window.DATA;
  const proj = D.projects.find(p => p.id === "datahandler");
  const prereqs = D.prereqs;
  const foundation = prereqs.filter(p => p.lane === "foundation");
  const maintenance = prereqs.filter(p => p.lane === "maintenance");

  // Resolve runtime state per op given the gate setting.
  // When workflowInstalled=false, force the "workflow" op into "next" and downstream gated.
  const opState = (p) => {
    if (p.id === "workflow" && !workflowInstalled) return "next";
    return p.state; // done | stale | missing | next | running | locked
  };

  // Is each step's prerequisite met?
  const prereqsMet = (p) => {
    if (!p.requires?.length) return true;
    return p.requires.every(r => {
      const reqOp = prereqs.find(x => x.id === r);
      const s = opState(reqOp);
      return s === "done" || s === "stale";
    });
  };

  const setupDone = workflowInstalled ? 3 : 2;
  const setupTotal = 3;
  const setupComplete = setupDone === setupTotal;

  return (
    <div className="main">
      <div className="topbar">
        <div className="crumb">
          <Icon name="workspace" size={14} />
          <span>meas</span>
          <span className="sep">/</span>
          <span className="now">{proj.name}</span>
        </div>
        <div className="spacer"></div>
        <button className="btn ghost"><Icon name="refresh" size={12} />Refresh state</button>
        <button className="btn"><Icon name="cmd" size={12} />Run command…</button>
        <button
          className={cls("btn", workflowInstalled ? "primary" : "")}
          disabled={!workflowInstalled}
          onClick={() => workflowInstalled && goto("kickoff")}
          title={workflowInstalled ? "" : "Install /claudboard-workflow first"}
          style={!workflowInstalled ? { opacity: 0.45, cursor: "not-allowed" } : null}
        >
          {workflowInstalled
            ? <><Icon name="rocket" size={12} />Start feature</>
            : <><Icon name="lock" size={12} />Start feature</>}
        </button>
      </div>

      <div className="page">
        <div className="proj-head">
          <div className="pmark">{proj.mark}</div>
          <div className="pinfo">
            <div className="pname">{proj.name}</div>
            <div className="ppath">{proj.path}  ·  branch {proj.defaultBranch}</div>
            <div className="pchips">
              <span className="chip">{proj.stack.split(" · ")[0]}</span>
              <span className="chip">{proj.stack.split(" · ")[1]}</span>
              <span className="chip violet"><Icon name="db" size={10} />MongoDB</span>
              <span className="chip violet"><Icon name="cloud" size={10} />Kafka</span>
              <span className="chip mono">Jira · MEAS</span>
              <span className="chip mono">ADO · meas-cloud</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
            {workflowInstalled
              ? <><StatusChip status="running" /><div style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }}>1 active run</div></>
              : <><StatusChip status="missing" /><div style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }}>setup incomplete</div></>}
          </div>
        </div>

        {/* ───── Workspace setup banner (sticky priority) ───── */}
        {!setupComplete && (
          <div className={cls("setup-banner", !workflowInstalled && "gated")}>
            <div className="sb-ico">
              {workflowInstalled ? <Icon name="spark" size={18} /> : <Icon name="lock" size={18} />}
            </div>
            <div>
              <div className="sb-t">
                {workflowInstalled ? "Finish setting up claudboard for this workspace" : "feature-workflow isn't installed for the meas workspace"}
                <span className="chip violet" style={{ padding: "2px 8px" }}>workspace-level</span>
              </div>
              <div className="sb-s">
                {workflowInstalled
                  ? <>Run /refresh and clear staleness before the next feature run.</>
                  : <>Feature runs are locked until the orchestrator skill exists at <code className="mono" style={{ color: "var(--text)" }}>meas.workspace/.claude/skills/feature-workflow/</code>. Next step: run <b>/claudboard-workflow</b> — it needs the analysis report and generated rules to be in place (both ✓).</>}
              </div>
              <div className="sb-prog">
                <div className="sb-bar"><div className="sb-fill" style={{ width: `${(setupDone/setupTotal)*100}%` }}></div></div>
                <span className="sb-pct">{setupDone} of {setupTotal} done</span>
                {!workflowInstalled && (
                  <span style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }}>·  /claudboard-workflow is next</span>
                )}
              </div>
            </div>
            <div>
              {workflowInstalled
                ? <button className="btn amber" style={{ padding: "8px 14px" }}><Icon name="refresh" size={12} />Refresh now</button>
                : <button className="btn amber" style={{ padding: "8px 14px" }}><Icon name="play" size={12} />Run /claudboard-workflow</button>}
            </div>
          </div>
        )}
        {setupComplete && (
          <div className="setup-banner complete">
            <div className="sb-ico"><Icon name="check" size={16} /></div>
            <div>
              <div className="sb-t" style={{ fontSize: "var(--fs-sm)" }}>
                Setup complete for meas workspace
                <span className="chip" style={{ padding: "1px 7px", fontSize: "10px" }}>3 / 3 foundation steps</span>
              </div>
            </div>
            <button className="btn ghost sm"><Icon name="chev" size={11} />Show details</button>
          </div>
        )}

        {/* ───── Metrics ───── */}
        <div className="health-grid">
          <div className="metric">
            <div className="ml">Workspace setup</div>
            <div className="mv">{setupDone}<span style={{ fontSize: "14px", color: "var(--muted)" }}>/{setupTotal}</span></div>
            <div className="ms">
              <HealthBar states={workflowInstalled ? ["g","g","g","g","g"] : ["g","g","r","r","g"]} />
            </div>
          </div>
          <div className="metric">
            <div className="ml">Generated artifacts</div>
            <div className="mv">19</div>
            <div className="ms">
              <span style={{ color: "var(--green)" }}>+3</span>
              <span>·</span>
              <span>7 rules · 4 skills · 1 CLAUDE.md</span>
            </div>
          </div>
          <div className="metric">
            <div className="ml">Features shipped</div>
            <div className="mv">14</div>
            <div className="ms">
              <Spark data={[.3,.5,.4,.7,.6,.8,.5,.9,.7,.6,.8,1,.7,.9]} />
            </div>
          </div>
          <div className="metric">
            <div className="ml">Avg run · cost</div>
            <div className="mv">2h&nbsp;48m</div>
            <div className="ms">
              <span className="mono">$1.94 / feature</span>
              <span>·</span>
              <span style={{ color: "var(--green)" }}>↓ 12%</span>
            </div>
          </div>
        </div>

        {/* ───── Foundation (ordered chain) ───── */}
        <div className="group-h">
          <h2>Foundation</h2>
          <span className="sub">ordered — each step requires the previous · feature-workflow gates feature runs</span>
          <span className="badge">{setupDone} / {setupTotal}</span>
        </div>

        <div className="chain">
          {foundation.map((p, i) => {
            const state = opState(p);
            const isLast = i === foundation.length - 1;
            return (
              <React.Fragment key={p.id}>
                <OpCard p={p} state={state} prereqsMet={prereqsMet(p)} goto={goto} />
                {!isLast && (
                  <div className={cls("chain-link", opState(foundation[i]) === "done" && "done", opState(foundation[i+1]) === "next" && "next")}>
                    <Icon name="arrow" size={14} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* ───── Maintenance (parallel) ───── */}
        <div className="group-h">
          <h2>Maintenance</h2>
          <span className="sub">available once foundation is done — keeps artifacts fresh</span>
        </div>

        <div className="maint">
          {maintenance.map(p => (
            <OpCard key={p.id} p={p} state={opState(p)} prereqsMet={prereqsMet(p)} goto={goto} maintenance />
          ))}
        </div>

        {/* ───── Artifacts ───── */}
        <h2 style={{ marginTop: "28px" }}>Generated artifacts</h2>
        <div className="card">
          <div className="card-head">
            <h3>.claude/ tree</h3>
            <span className="head-sub">written by /generate · 2d ago · 19 files · 4.2 KB</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
              <button className="btn ghost sm"><Icon name="folder" size={11} />Open in editor</button>
            </div>
          </div>
          <div className="card-body tight">
            <div className="artifact-tree">
              <div>.claude/</div>
              <div>├── <span className="gline">CLAUDE.md</span>                              <span className="dim"># 112 lines · architecture · build · rules</span></div>
              <div>├── rules/                                       <span className="dim"># 7 files · paths: frontmatter</span></div>
              <div>│   ├── <span className="gline">java-conventions.md</span></div>
              <div>│   ├── <span className="gline">spring-boot-conventions.md</span></div>
              <div>│   ├── <span className="gline">mongodb-conventions.md</span></div>
              <div>│   ├── <span className="gline">kafka-producer.md</span></div>
              <div>│   ├── <span className="gline">testing-rules.md</span></div>
              <div>│   ├── <span className="new">architecture.md</span>                       <span className="dim"># new · hexagonal layering</span></div>
              <div>│   └── <span className="gline">infrastructure-context.md</span></div>
              <div>├── skills/</div>
              <div>│   {workflowInstalled
                ? <>├── <span className="gline">feature-workflow/</span>                <span className="dim"># orchestrator · 17 files</span></>
                : <><span style={{ color: "var(--red)" }}>├── feature-workflow/                </span><span className="dim"># missing · run /claudboard-workflow</span></>}
              </div>
              <div>│   ├── <span className="gline">rest-controller/</span></div>
              <div>│   ├── <span className="gline">mongodb-persistence/</span></div>
              <div>│   └── <span className="gline">integration-test/</span></div>
              <div>├── reports/</div>
              <div>│   ├── <span className="mline">claudboard-analysis.md</span>                <span className="dim"># 2d old · ⓘ imported (terminal /analyse)</span></div>
              <div>│   └── <span className="dim">techdebt.md                              # missing · run /techdebt</span></div>
              <div>└── memories/                                <span className="dim"># empty</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// OpCard — one card in the foundation chain or maintenance grid
// ─────────────────────────────────────────────────────────────
function OpCard({ p, state, prereqsMet, goto, maintenance }) {
  // Display state — locked when prereqs not met
  let displayState = state;
  if (!prereqsMet && (state === "missing" || state === "next")) displayState = "locked";

  const StatusLabel = () => {
    const map = {
      done:     { label: "Done",      cls: "done" },
      running:  { label: "Running",   cls: "running" },
      next:     { label: "Next",      cls: "next" },
      stale:    { label: "Stale",     cls: "stale" },
      missing:  { label: "Not run",   cls: "missing" },
      locked:   { label: "Locked",    cls: "locked" },
    };
    const m = map[displayState] || { label: displayState, cls: "" };
    return <span className={cls("op-status", m.cls)}>{m.label}</span>;
  };

  const step = p.step
    ? p.step
    : p.id === "refresh" ? <Icon name="refresh" size={11} />
    : p.id === "techdebt" ? <Icon name="alert" size={11} />
    : "?";

  // Actions vary by state
  let actions;
  if (displayState === "done" && !p.imported) {
    actions = (
      <>
        <button className="btn ghost sm"><Icon name="eye" size={11} />Report</button>
        <button className="btn sm"><Icon name="refresh" size={11} />Re-run</button>
      </>
    );
  } else if (displayState === "done" && p.imported) {
    actions = (
      <>
        <span className="op-imported"><Icon name="download" size={9} />imported</span>
        <button className="btn ghost sm">View</button>
        <button className="btn sm"><Icon name="refresh" size={11} />Re-run</button>
      </>
    );
  } else if (displayState === "next") {
    actions = (
      <>
        <button className="btn ghost sm">Preview</button>
        <button className="btn amber sm"><Icon name="play" size={11} />Run now</button>
      </>
    );
  } else if (displayState === "running") {
    actions = (
      <>
        <span className="op-status running" style={{ marginRight: "auto" }}>● running</span>
        <button className="btn ghost sm">View stream</button>
      </>
    );
  } else if (displayState === "stale") {
    actions = (
      <>
        <button className="btn ghost sm"><Icon name="diff" size={11} />Diff</button>
        <button className="btn amber sm"><Icon name="refresh" size={11} />Refresh</button>
      </>
    );
  } else if (displayState === "missing") {
    actions = <button className="btn accent sm"><Icon name="play" size={11} />Run</button>;
  } else if (displayState === "locked") {
    const blockedBy = p.requires.map(r => r === "analyse" ? "Analyse" : r === "generate" ? "Generate" : r === "workflow" ? "Workflow" : r).join(" + ");
    actions = (
      <span className="op-req" style={{ marginLeft: "auto" }}>
        <Icon name="lock" size={11} className="req-lock" />
        requires {blockedBy}
      </span>
    );
  }

  return (
    <div className={cls("op-card", displayState)}>
      <div className="op-head">
        <span className="op-step">{step}</span>
        <span className="op-title">{p.title}</span>
        <StatusLabel />
      </div>
      <div className="op-cmd">{p.cmd}</div>
      <div className="op-desc">{p.desc}</div>
      {displayState !== "locked" && (
        <div className="op-meta">
          {p.duration !== "—" && <span><Icon name="clock" size={10} style={{ verticalAlign: "-2px", marginRight: "3px" }} />{p.ago}</span>}
          {p.duration !== "—" && <span>· {p.duration}</span>}
          {p.cost !== "—" && <span>· {p.cost}</span>}
          {p.note && <span style={{ color: displayState === "stale" ? "var(--amber)" : displayState === "missing" ? "var(--muted)" : "var(--muted)" }}>· {p.note}</span>}
        </div>
      )}
      <div className="op-foot">{actions}</div>
    </div>
  );
}

window.ScreenProject = ScreenProject;
