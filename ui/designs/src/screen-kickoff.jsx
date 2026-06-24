/* eslint-disable */
/* Start feature — kickoff form */

const ScreenKickoff = ({ goto }) => {
  const D = window.DATA;
  const [desc, setDesc] = React.useState("Add an outbox dispatcher for entitlement events. When an entitlement is granted, persist an outbox row in the tenant DB, then a scheduled dispatcher publishes pending events to Kafka in FIFO. Survive broker outages without losing events.");
  const [repo, setRepo] = React.useState("datahandler");
  const [type, setType] = React.useState("feature");

  const slug = desc.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 6).join("-") || "new-feature";

  return (
    <div className="main">
      <div className="topbar">
        <div className="crumb">
          <Icon name="workspace" size={14} />
          <span>meas</span>
          <span className="sep">/</span>
          <span className="now">Start feature</span>
        </div>
        <div className="spacer"></div>
        <span className="key">⌘ ↵  to start</span>
      </div>

      <div className="page" style={{ overflowY: "auto" }}>
        <div className="kick-wrap">
          <div className="kick-card">
            <h1>Start a feature</h1>
            <div className="sub">claudboard will create a Jira ticket, write a BDD spec, plan execution, then pause for your approval before running autonomously.</div>

            <label style={{ display: "block", fontSize: "var(--fs-xs)", color: "var(--muted)", marginBottom: "6px", fontWeight: 500 }}>
              What do you want to build?
            </label>
            <textarea
              className="kick-input"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Describe the feature. Be specific about behavior, but skip implementation details — sdd-expert and architect will handle those."
            />

            <div className="kick-grid">
              <div className="kick-field">
                <label>Repo</label>
                <select className="kick-select" value={repo} onChange={(e) => setRepo(e.target.value)}>
                  {D.projects.filter(p => p.id !== "azure-devops-mcp").map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="kick-field">
                <label>Branch type</label>
                <select className="kick-select" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="feature">feature</option>
                  <option value="bugfix">bugfix</option>
                  <option value="hotfix">hotfix</option>
                </select>
              </div>
              <div className="kick-field">
                <label>Jira project</label>
                <select className="kick-select" defaultValue="MEAS">
                  <option>MEAS</option>
                  <option>PLAT</option>
                </select>
              </div>
              <div className="kick-field">
                <label>Issue type</label>
                <select className="kick-select" defaultValue="Story">
                  <option>Story</option>
                  <option>Task</option>
                  <option>Bug</option>
                </select>
              </div>
            </div>

            <div className="preview-card">
              <div className="ph">─ preview ─</div>
              <div style={{ marginTop: "8px" }}>
                <span style={{ color: "var(--violet)" }}>$ /start-feature</span>{" "}
                <span style={{ color: "var(--text)" }}>"{desc.slice(0, 70)}{desc.length > 70 ? "…" : ""}"</span>
              </div>
              <div style={{ marginTop: "10px", color: "var(--muted)" }}>
                <div>→ jira-agent: create issue · project=<span style={{ color: "var(--text)" }}>MEAS</span> · type=<span style={{ color: "var(--text)" }}>{type === "bugfix" ? "Bug" : "Story"}</span></div>
                <div>→ branch:      <span style={{ color: "var(--teal)" }}>{type}/MEAS-<span style={{ color: "var(--text)" }}>NNNN</span>/{slug}</span></div>
                <div>→ repo:        <span style={{ color: "var(--text)" }}>{D.projects.find(p => p.id === repo)?.path}</span></div>
                <div>→ phases:      1 → 7 · 1 human gate after spec + plan</div>
                <div>→ est. cost:   <span style={{ color: "var(--text)" }}>$1.40 – $2.60</span> · ~3h autonomous</div>
              </div>
            </div>

            <div className="kick-foot">
              <span className="hint">
                Spec + plan approval gate runs in ~6 min. After that the workflow is unattended.
              </span>
              <button className="btn ghost">Save draft</button>
              <button className="btn accent" onClick={() => goto("run")}>
                <Icon name="rocket" size={12} />Start feature
              </button>
            </div>
          </div>

          {/* compact recent runs */}
          <div style={{ marginTop: "28px" }}>
            <h2 style={{ fontSize: "var(--fs-md)", color: "var(--muted)", fontWeight: 600, letterSpacing: ".02em", margin: "0 0 12px" }}>Recent in this repo</h2>
            <div className="card">
              {[
                { t:"MEAS-7140", n:"Outbox dispatcher for entitlement events", s:"gate", ago:"now" },
                { t:"MEAS-7128", n:"Tenant-scoped audit log endpoint", s:"merged", ago:"yesterday" },
                { t:"MEAS-7102", n:"Add PaymentMethodDto v2", s:"merged", ago:"3d" },
                { t:"MEAS-7081", n:"Migrate scheduler off Quartz", s:"merged", ago:"6d" },
              ].map((r, i) => (
                <div key={i} className="row">
                  <span className="chip mono violet" style={{ padding: "2px 7px" }}><Icon name="ticket" size={10} />{r.t}</span>
                  <span style={{ flex: 1, color: "var(--text)" }}>{r.n}</span>
                  <StatusChip status={r.s} />
                  <span className="mono" style={{ fontSize: "var(--fs-xs)", color: "var(--muted)" }}>{r.ago}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

window.ScreenKickoff = ScreenKickoff;
