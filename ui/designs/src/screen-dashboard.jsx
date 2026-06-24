/* eslint-disable */
/* Overview — workspace level. Services directory + cross-service edges +
   Recent workflow runs. Multi-repo shape (matches the demo data). */

const ScreenDashboard = ({ goto, workflowInstalled }) => {
  const D = window.DATA;
  const setupComplete = workflowInstalled;

  return (
    <div className="main">
      <div className="topbar">
        <div className="crumb">
          <Icon name="workspace" size={14} />
          <span className="now">meas</span>
          <span className="sep">·</span>
          <span style={{ color: "var(--muted)" }}>multi-repo workspace</span>
        </div>
        <div className="spacer"></div>
        <button className="btn ghost"><Icon name="cmd" size={12} />Command palette</button>
        <button
          className={cls("btn", workflowInstalled && "primary")}
          disabled={!workflowInstalled}
          onClick={() => workflowInstalled && goto("kickoff")}
          style={!workflowInstalled ? { opacity: 0.45, cursor: "not-allowed" } : null}
          title={workflowInstalled ? "" : "Install /claudboard-workflow first"}
        >
          {workflowInstalled
            ? <><Icon name="rocket" size={12} />Start feature</>
            : <><Icon name="lock" size={12} />Start feature</>}
        </button>
      </div>

      <div className="page">
        <h1>meas <span style={{
          fontSize: "10px", fontWeight: 700, fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em", textTransform: "uppercase",
          padding: "3px 8px", borderRadius: "999px",
          background: "var(--teal-dim)", color: "var(--teal)",
          marginLeft: "10px", verticalAlign: "middle",
        }}>multi-repo · 6 repos</span></h1>
        <div className="sub">~/work/meas/  ·  meta-repo: meas.workspace · symlinked .claude/  ·  Jira MEAS · ADO meas-cloud</div>

        {/* ───── Setup banner (visible only when incomplete) ───── */}
        {!setupComplete && (
          <div className="setup-banner gated" style={{ marginTop: "18px" }}>
            <div className="sb-ico"><Icon name="lock" size={18} /></div>
            <div>
              <div className="sb-t">
                feature-workflow isn't installed for the meas workspace
                <span className="chip violet" style={{ padding: "2px 8px" }}>workspace-level</span>
              </div>
              <div className="sb-s">
                Feature runs are locked until the orchestrator skill exists at <code className="mono" style={{ color: "var(--text)" }}>meas.workspace/.claude/skills/feature-workflow/</code>.
              </div>
              <div className="sb-prog">
                <div className="sb-bar"><div className="sb-fill" style={{ width: "66%" }}></div></div>
                <span className="sb-pct">2 of 3 done</span>
                <span style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }}>·  /claudboard-workflow is next</span>
              </div>
            </div>
            <button className="btn amber" onClick={() => goto("project")} style={{ padding: "8px 14px" }}>
              <Icon name="arrow" size={12} />Go to setup
            </button>
          </div>
        )}

        {/* ───── KPI strip ───── */}
        <div className="health-grid" style={{ marginTop: setupComplete ? "16px" : "20px" }}>
          <div className="metric">
            <div className="ml">Active runs</div>
            <div className="mv" style={{ color: workflowInstalled ? "var(--teal)" : "var(--dim)" }}>
              {workflowInstalled ? 1 : 0}
            </div>
            <div className="ms">
              {workflowInstalled
                ? <span className="chip teal"><span className="dot pulse"></span>MEAS-7140</span>
                : <span style={{ color: "var(--muted)" }}>setup required</span>}
            </div>
          </div>
          <div className="metric">
            <div className="ml">Awaiting gate</div>
            <div className="mv" style={{ color: workflowInstalled ? "var(--amber)" : "var(--dim)" }}>
              {workflowInstalled ? 1 : 0}
            </div>
            <div className="ms">{workflowInstalled ? "phase 1d · spec + plan" : "—"}</div>
          </div>
          <div className="metric">
            <div className="ml">In review</div>
            <div className="mv">{workflowInstalled ? 2 : 0}</div>
            <div className="ms">{workflowInstalled ? "PRs open · ADO" : "—"}</div>
          </div>
          <div className="metric">
            <div className="ml">Merged this week</div>
            <div className="mv" style={{ color: workflowInstalled ? "var(--green)" : "var(--text)" }}>
              {workflowInstalled ? 5 : 0}
            </div>
            <div className="ms">
              <Spark data={[.4,.7,.5,.9,.6,1,.5]} />
            </div>
          </div>
        </div>

        {/* ───── Services directory ───── */}
        <div className="group-h">
          <h2>Services</h2>
          <span className="sub">repositories in this workspace</span>
          <span className="badge" style={{ marginLeft: "auto" }}>{D.projects.length} repos</span>
        </div>

        <div className="card">
          {D.projects.map(p => {
            const isRunning = p.lastRunStatus === "running" && workflowInstalled;
            const isReview  = p.lastRunStatus === "review" && workflowInstalled;
            return (
              <div
                key={p.id}
                className="proj-row"
                style={{
                  gridTemplateColumns: "36px 1fr 1fr 110px 90px",
                  gap: "16px",
                  padding: "12px 16px",
                  cursor: "pointer",
                }}
                onClick={() => goto("project")}
              >
                <div className="pmark-sm">{p.mark}</div>
                <div>
                  <div className="pn">{p.name}</div>
                  <div className="pp">{p.path}  ·  branch {p.defaultBranch}</div>
                </div>
                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                  {p.stack.split(" · ").slice(0, 3).map((s, i) => (
                    <span key={i} className="chip" style={{ fontSize: "10px" }}>{s}</span>
                  ))}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--muted)" }}>
                  {p.lastRunAgo} ago
                </div>
                <div style={{ textAlign: "right" }}>
                  {isRunning && <span className="chip teal"><span className="dot pulse"></span>active</span>}
                  {isReview  && <span className="chip violet">in review</span>}
                  {!isRunning && !isReview && (
                    <span style={{ fontSize: "10px", color: "var(--dim)", fontFamily: "var(--font-mono)" }}>—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ───── Cross-service edges + Recent runs ───── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.5fr",
          gap: "14px",
          marginTop: "20px",
        }}>
          {/* Edges */}
          <div className="card">
            <div className="card-head">
              <h3>Cross-service edges</h3>
              <span className="head-sub">from workflow-signals · 4 edges</span>
            </div>
            <div className="edges">
              <div className="e-row">
                <div className="e-from">controller</div>
                <div className="arr">→<span className="kp">Kafka</span>→</div>
                <div className="e-to">datahandler</div>
              </div>
              <div className="e-row">
                <div className="e-from">datahandler</div>
                <div className="arr">→<span className="kp">Kafka</span>→</div>
                <div className="e-to">controller</div>
              </div>
              <div className="e-row">
                <div className="e-from">web</div>
                <div className="arr">→<span className="kp">REST</span>→</div>
                <div className="e-to">gateway</div>
              </div>
              <div className="e-row">
                <div className="e-from">gateway</div>
                <div className="arr">→<span className="kp">REST</span>→</div>
                <div className="e-to">controller + dh</div>
              </div>
              <div className="e-foot">
                <span>Shared lib: <span style={{ color: "var(--text)" }}>common-dto</span></span>
                <span style={{ color: "var(--violet)" }}>3 consumers</span>
              </div>
            </div>
          </div>

          {/* Recent runs */}
          <div className="card">
            <div className="card-head">
              <h3>Recent runs</h3>
              <span className="head-sub">workflow runs · last 30 days</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
                <button className="btn ghost sm">View all →</button>
              </div>
            </div>
            {workflowInstalled ? (
              <>
                <div className="feat-row" onClick={() => goto("gate")}>
                  <span className="tkt">MEAS-7140</span>
                  <div className="ttl">Outbox dispatcher for entitlement events<span className="sb">datahandler · 13m · $0.84</span></div>
                  <span><span className="chip amber"><span className="dot pulse"></span>at gate</span></span>
                  <span className="ago">now</span>
                </div>
                <div className="feat-row">
                  <span className="tkt">MEAS-7138</span>
                  <div className="ttl">Tenant-scoped audit log endpoint<span className="sb">controller · 3h 41m · $4.21</span></div>
                  <span><span className="chip violet">in review</span></span>
                  <span className="ago">2h</span>
                </div>
                <div className="feat-row">
                  <span className="tkt">PLAT-4821</span>
                  <div className="ttl">Add /refresh stale-rule detection<span className="sb">claudboard · 2h 18m · $2.62</span></div>
                  <span><span className="chip green"><span className="dot"></span>merged</span></span>
                  <span className="ago">17h</span>
                </div>
                <div className="feat-row">
                  <span className="tkt">MEAS-7128</span>
                  <div className="ttl">Migrate scheduler off Quartz to Spring-scheduling<span className="sb">controller · 5h 12m · $8.42</span></div>
                  <span><span className="chip green"><span className="dot"></span>merged</span></span>
                  <span className="ago">2d</span>
                </div>
                <div className="feat-row">
                  <span className="tkt">MEAS-7102</span>
                  <div className="ttl">Add PaymentMethodDto v2<span className="sb">common-dto · 52m · $1.18</span></div>
                  <span><span className="chip green"><span className="dot"></span>merged</span></span>
                  <span className="ago">2d</span>
                </div>
                <div className="feat-row">
                  <span className="tkt">MEAS-7088</span>
                  <div className="ttl">Reactive entitlement projection<span className="sb">datahandler · 4h 02m · $5.74</span></div>
                  <span><span className="chip red"><span className="dot"></span>aborted</span></span>
                  <span className="ago">3d</span>
                </div>
                <div className="feat-row">
                  <span className="tkt">MEAS-7081</span>
                  <div className="ttl">Tenant header propagation middleware<span className="sb">controller · 2h 33m · $3.42</span></div>
                  <span><span className="chip green"><span className="dot"></span>merged</span></span>
                  <span className="ago">5d</span>
                </div>
              </>
            ) : (
              <div style={{
                padding: "40px 20px",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: "var(--fs-sm)",
              }}>
                <div style={{ marginBottom: "10px", display: "inline-grid", placeItems: "center", width: "32px", height: "32px", borderRadius: "8px", background: "var(--surface-2)" }}>
                  <Icon name="lock" size={14} />
                </div>
                <div style={{ marginBottom: "4px", color: "var(--text-2)" }}>No runs yet</div>
                <div style={{ fontSize: "var(--fs-xs)" }}>Install feature-workflow to enable feature runs across this workspace.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

window.ScreenDashboard = ScreenDashboard;
